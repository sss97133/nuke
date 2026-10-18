-- The first natural job315 run after #857 enqueued at 2026-10-07 18:47:00Z.
-- pg_net request164297 timed out after its default5000ms while decoder-marked
-- vehicle updates continued through 18:47:06. A separate no-write batch100
-- probe returned200, 91 candidates, zero errors, in3.15s. Enqueue success is
-- not an HTTP completion assay. Give this existing job a finite60s response
-- budget; preserve its source, auth helper, batch100, cadence and active flag.
-- No manual invocation, schedule activation, data rewrite or paid service.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
DO $patch$
DECLARE
  v_command text;
  v_original constant text := $expected$
    SELECT net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co' || '/functions/v1/batch-vin-decode',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := '{"batch_size": 100}'::jsonb
    );
  $expected$;
BEGIN
  SELECT command INTO STRICT v_command FROM cron.job
  WHERE jobid=315 AND jobname='batch-vin-decode-backfill';
  IF v_command=v_original THEN
    v_command:=regexp_replace(v_command,'\)(;[[:space:]]*)$',', timeout_milliseconds := 60000)\1');
    IF v_command NOT LIKE '%, timeout_milliseconds := 60000)%' THEN
      RAISE EXCEPTION 'VIN job command suffix differs; refusing patch';
    END IF;
    PERFORM cron.alter_job(job_id:=315,command:=v_command);
  ELSIF replace(v_command,', timeout_milliseconds := 60000','')<>v_original
        OR v_command NOT LIKE '%, timeout_milliseconds := 60000)%' THEN
    RAISE EXCEPTION 'VIN job command differs from reviewed SQL; refusing patch';
  END IF;
END
$patch$;
COMMIT;
