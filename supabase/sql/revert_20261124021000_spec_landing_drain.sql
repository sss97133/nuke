-- Revert of 20261124021000_spec_landing_drain.sql. Stops the loop; queued runs keep their rows (revert those runs with
-- data_set_membership_revert_v1 / text_code_decode_revert_v1 as listed in supabase/sql/revert_20261124020000_spec_readings.sql).
begin;
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('spec-landing-drain-1','spec-landing-drain-2','spec-landing-drain-3');
DROP FUNCTION IF EXISTS public.spec_landing_drain_v1(integer);
-- spec_landing_jobs is kept: it is the record of what ran.
commit;
