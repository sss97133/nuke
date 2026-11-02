\set ON_ERROR_STOP on
\i supabase/sql/test_observation_analysis_pending_clock.sql
-- Capture the real migration's scheduled command in this disposable database.
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(name text,schedule text,command text) RETURNS bigint LANGUAGE sql AS $$
 INSERT INTO cron.job(jobname,schedule,command) VALUES(name,schedule,command)
 ON CONFLICT(jobname) DO UPDATE SET schedule=excluded.schedule,command=excluded.command RETURNING jobid
$$;
INSERT INTO cron.job(jobname,schedule,command,active) VALUES
 ('derivation-queue-drain','8-59/10 * * * *','existing paid-capable route',true),
 ('photo-pipeline-drain','*/5 * * * *','held photo route',false),
 ('analysis-engine-sweep','*/5 * * * *','held paid route',false);
CREATE SCHEMA net;
CREATE TABLE net.requests(url text,headers jsonb,body jsonb,timeout_milliseconds integer);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
 BEGIN INSERT INTO net.requests VALUES(url,headers,body,timeout_milliseconds); RETURN 1; END $$;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://fixture.test'::text $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'fixture-service'::text $$;
CREATE TEMP TABLE queue_before AS SELECT * FROM public.analysis_queue;
\i supabase/migrations/20261030195337_drain_registered_retained_work.sql
DO $$ DECLARE wake_command text; BEGIN
 SELECT j.command INTO wake_command FROM cron.job j WHERE jobname='analysis-retained-drain'; EXECUTE wake_command;
 PERFORM pg_temp.ok('dedicated wake cannot sweep or invoke a provider/paid dispatcher',
  (SELECT url='https://fixture.test/functions/v1/analysis-engine-coordinator'
   AND body='{"action":"compute_retained","batch_size":20,"time_budget_ms":45000}'::jsonb
   AND timeout_milliseconds=55000 AND headers->>'Authorization'='Bearer fixture-service' FROM net.requests));
 PERFORM pg_temp.ok('held photo/paid sweeps and existing shared cadence are preserved',
  (SELECT bool_and(NOT active) FROM cron.job WHERE jobname IN('photo-pipeline-drain','analysis-engine-sweep'))
  AND (SELECT schedule='8-59/10 * * * *' AND command='existing paid-capable route' AND active FROM cron.job WHERE jobname='derivation-queue-drain'));
 PERFORM pg_temp.ok('scheduling never enrolls or changes source obligations',
  NOT EXISTS((SELECT * FROM public.analysis_queue EXCEPT SELECT * FROM queue_before)
   UNION ALL(SELECT * FROM queue_before EXCEPT SELECT * FROM public.analysis_queue)));
END $$;
-- Reapplication is deterministic and schedules just one named wake.
\i supabase/migrations/20261030195337_drain_registered_retained_work.sql
SELECT pg_temp.ok('bounded wake reapplication creates no duplicate job',
 (SELECT count(*)=1 AND min(schedule)='* * * * *' FROM cron.job WHERE jobname='analysis-retained-drain'));
