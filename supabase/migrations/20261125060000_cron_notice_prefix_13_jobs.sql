-- 13 cron jobs stop being able to stall the pg_cron launcher. Each one is listed in v_cron_notice_risk
-- (20261125053000): a multi-statement command with no leading SET client_min_messages that calls a function able to
-- raise a NOTICE mid-run (IF [NOT] EXISTS DDL or RAISE NOTICE/WARNING/INFO). With cron.use_background_workers off,
-- such a notice holds the launcher until the job ends. That is what jobs 526 and 646 did every night, for 149-328 s
-- (fixed in 20261125041500 and 20261125051500).
--
-- CHANGE: cron.alter_job on each existing row, prefixing SET client_min_messages = error. No reschedule, nothing
-- else in the command changes. Idempotent: a command that already begins with the prefix is left alone.
-- The server log still records notices and warnings. cron.job_run_details.return_message is unchanged: it holds the
-- last result or the error, and errors are still sent. Its only consumers, refresh_job_health and v_job_health, read it
-- only for failed runs (checked 2026-11-25).
-- Owners: 681 and 744-746 belong to the facts lane and were told before ship. The other 9 have no live lane in
-- LANES.md.
-- CHECK: v_cron_notice_risk returns 0 rows after the change, or the migration fails and changes nothing.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE r record; c text; left_n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      (499, 'derive-vehicle-image-attribution'), (500, 'drain-vehicle-derived-queues'), (574, 'drain-metric-slow'),
      (645, 'map-facts-recent'), (681, 'field-consensus-sweep'), (694, 'profile-quality-scorecard-hourly'),
      (724, 'fx_label_vehicle_sales'), (731, 'photo-analysis-yield-hourly'), (736, 'photo-gps-location'),
      (741, 'drain-class-price-queue'), (744, 'spec-landing-drain-1'), (745, 'spec-landing-drain-2'),
      (746, 'spec-landing-drain-3')) v(jobid, jobname)
  LOOP
    SELECT command INTO c FROM cron.job WHERE jobid = r.jobid AND jobname = r.jobname;
    IF c IS NULL THEN RAISE EXCEPTION 'cron job % % not found', r.jobid, r.jobname; END IF;
    IF c !~* '^\s*set\s+client_min_messages' THEN
      PERFORM cron.alter_job(job_id := r.jobid, command := 'SET client_min_messages = error; ' || c);
    END IF;
  END LOOP;
  SELECT count(*) INTO left_n FROM public.v_cron_notice_risk;
  IF left_n > 0 THEN
    RAISE EXCEPTION 'v_cron_notice_risk still lists % job(s): %', left_n,
      (SELECT string_agg(jobid::text || ' ' || jobname, ', ') FROM public.v_cron_notice_risk);
  END IF;
END $$;
COMMIT;
