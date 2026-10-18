\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='cron') THEN
  RAISE EXCEPTION 'Empty disposable database only';
 END IF;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text,command text,schedule text,active boolean);
CREATE FUNCTION cron.alter_job(job_id bigint,command text) RETURNS void LANGUAGE sql AS $$
 UPDATE cron.job SET command=$2 WHERE jobid=$1;
$$;
INSERT INTO cron.job VALUES(315,'batch-vin-decode-backfill',$cmd$
    SELECT net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co' || '/functions/v1/batch-vin-decode',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := '{"batch_size": 100}'::jsonb
    );
  $cmd$,'2-59/15 * * * *',true);
CREATE TEMP TABLE original AS SELECT * FROM cron.job;
\ir ../migrations/20261007185155_bound_vin_decode_http_timeout.sql
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM cron.job j JOIN original o USING(jobid)
  WHERE replace(j.command,', timeout_milliseconds := 60000','')=o.command
   AND j.command LIKE '%, timeout_milliseconds := 60000)%'
   AND j.active=o.active AND j.schedule=o.schedule) THEN RAISE EXCEPTION 'Unexpected command/cadence/state change'; END IF;
END $$;
-- Parse the resulting command against a synthetic pg_net signature; no HTTP.
CREATE SCHEMA net;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'synthetic-test-only'::text $$;
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN
 IF timeout_milliseconds<>60000 OR body->>'batch_size'<>'100' THEN RAISE EXCEPTION 'Wrong timeout or batch'; END IF;
 RETURN 1;
END $$;
DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobid=315); END $$;
\ir ../migrations/20261007185155_bound_vin_decode_http_timeout.sql
DO $$ BEGIN
 IF (SELECT length(command)-length(replace(command,'timeout_milliseconds','')) FROM cron.job WHERE jobid=315)<>length('timeout_milliseconds') THEN
 RAISE EXCEPTION 'Retry duplicated patch'; END IF;
END $$;
-- Also prove a pre-existing pause survives the patch.
UPDATE cron.job SET command=(SELECT command FROM original),active=false;
\ir ../migrations/20261007185155_bound_vin_decode_http_timeout.sql
DO $$ BEGIN IF (SELECT active FROM cron.job WHERE jobid=315) THEN RAISE EXCEPTION 'Pause removed'; END IF; END $$;
