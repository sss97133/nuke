-- field-evidence-settle-due (20261124194600) moves from minute 7 of each ten to minute 6.
--
-- WHY. Measured 2026-11-25: its first run (04:17 UTC) failed 'job startup timeout' together with six other jobs that start in
-- the same second. Minute 7 of each ten holds seven schedules (two other /10 jobs, four hourly, one twice-hourly) and had 28
-- of the 56 startup failures in the last 24 h; minutes 0, 4, 6 and 8 had none, and no active job is scheduled at minute 6.
-- (Its 03:47-04:07 slots produced no run row at all: the launcher had not reloaded the jobs 194600 scheduled; a no-op
-- cron.alter_job at 04:12 made it reload.)
-- WHAT. Same command, schedule '6-59/10 * * * *'. Only the minute changes.
-- REVERT: reschedule with '7-59/10 * * * *'. Contract: supabase/sql/test_settle_due_minute.sql.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('field-evidence-settle-due', '6-59/10 * * * *',
      $cmd$SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.field_evidence_rank_settle_due_v1(40);$cmd$);
  END IF;
END $cron$;
