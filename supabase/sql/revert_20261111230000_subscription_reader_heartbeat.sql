-- Revert of 20261111230000_subscription_reader_heartbeat.sql: the cron watch, the assay and the heartbeat writer. The two
-- job_assay_readings rows the readers wrote are left in place (they are readings, not testimony; refresh_job_health ignores
-- jobnames it does not know).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
DECLARE j bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'subscription-reader-watch' LOOP PERFORM cron.unschedule(j); END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.assay_subscription_readers();
DROP FUNCTION IF EXISTS public.record_reader_heartbeat(text, jsonb, integer);
