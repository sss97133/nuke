-- Honor the designed capture_landing_tick statement_timeout (120s) when pg_cron
-- runs the job as role postgres (role statement_timeout is 10s).
--
-- PostgreSQL does not apply a function-level SET statement_timeout to the
-- already-started statement (the cron SELECT). The 11:20 AST 2026-11-10 tick
-- cancelled at 10.009s inside capture_sets_score while planning the first
-- forward day at forward_cursor 2026-10-28 (401 photos). EXPLAIN ANALYZE of
-- the day scan used idx_vehicle_images_user_taken_at (9ms). A warm one-day
-- score finished in 7.1s; cold + tick/advance overhead exceeds 10s. The typ
-- blocked conjunct is a jsonb extract on already-read rows, not the cause.
-- Do not raise the postgres role timeout. Set 120s on the cron command so the
-- SELECT starts under the function's designed budget.
-- Revert: supabase/sql/revert_20261115150000_capture_landing_tick_cron_timeout.sql

SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $do$
DECLARE
  v_id bigint;
  v_cmd text;
  v_user name;
  v_new text := $c$SET statement_timeout = '120s'; SELECT public.capture_landing_tick()$c$;
BEGIN
  SELECT jobid, command, username INTO v_id, v_cmd, v_user
    FROM cron.job WHERE jobname = 'capture-sets-landing-tick';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'capture-sets-landing-tick cron job is not installed';
  END IF;
  IF v_cmd IS NOT DISTINCT FROM v_new THEN
    RAISE NOTICE 'capture-sets-landing-tick already honors the 120s tick budget';
    RETURN;
  END IF;
  IF btrim(v_cmd) IS DISTINCT FROM 'select public.capture_landing_tick()'
     AND btrim(v_cmd) IS DISTINCT FROM 'SELECT public.capture_landing_tick()' THEN
    RAISE EXCEPTION 'capture-sets-landing-tick command drifted (%); refusing timeout wrap', v_cmd;
  END IF;
  IF v_user IS DISTINCT FROM 'postgres' THEN
    RAISE NOTICE 'capture-sets-landing-tick username is %, wrapping anyway', v_user;
  END IF;
  PERFORM cron.alter_job(job_id := v_id, command := v_new);
END
$do$;
