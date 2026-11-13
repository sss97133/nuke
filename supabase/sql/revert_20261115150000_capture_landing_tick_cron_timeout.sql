-- Restore capture-sets-landing-tick to an unwrapped select (postgres role 10s).
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $do$
DECLARE
  v_id bigint;
  v_cmd text;
  v_new text := $c$SET statement_timeout = '120s'; SELECT public.capture_landing_tick()$c$;
BEGIN
  SELECT jobid, command INTO v_id, v_cmd FROM cron.job WHERE jobname = 'capture-sets-landing-tick';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'capture-sets-landing-tick cron job is not installed';
  END IF;
  IF v_cmd IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'refusing revert: capture-sets-landing-tick command is not the 120s wrap (%)', v_cmd;
  END IF;
  PERFORM cron.alter_job(job_id := v_id, command := 'select public.capture_landing_tick()');
END
$do$;
