-- Isolated PostgreSQL 17 contract for drain_vehicle_completion_queue_chunked (20261015110000). A stand-in for the
-- existing drain; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_completion && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_completion -f supabase/sql/test_drain_completion_queue_chunked.sql
-- Covered: one transaction per chunk; the queue is emptied; it stops when a chunk runs short; the chunk and budget clamps;
-- the three jobs are lone CALLs every minute; the ACL. Not covered: pg_cron, the real drain, cross-session locking.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.cq') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = $1 RETURNING true $$;
CREATE FUNCTION cron.schedule(name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES ($1, $2, $3) RETURNING jobid $$;

CREATE TABLE public.cq (vehicle_id serial PRIMARY KEY);
CREATE TABLE public.cq_log (id serial, xid bigint, took integer, lock_timeout text);
INSERT INTO public.cq SELECT FROM generate_series(1, 130);
CREATE FUNCTION public.drain_vehicle_completion_queue(p integer) RETURNS TABLE (processed integer, errored integer) LANGUAGE plpgsql AS $$
BEGIN
  WITH d AS (DELETE FROM public.cq WHERE vehicle_id IN (SELECT vehicle_id FROM public.cq ORDER BY vehicle_id LIMIT p FOR UPDATE SKIP LOCKED) RETURNING 1)
    SELECT count(*)::integer, 0 INTO processed, errored FROM d;
  INSERT INTO public.cq_log (xid, took, lock_timeout) VALUES (txid_current(), processed, current_setting('lock_timeout'));
  RETURN NEXT;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

\ir ../migrations/20261015110000_drain_completion_queue_own_jobs.sql
\ir ../migrations/20261015110000_drain_completion_queue_own_jobs.sql

CALL public.drain_vehicle_completion_queue_chunked(7, 25);
SELECT pg_temp.ok('130 rows in chunks of 25: 6 calls, 6 transactions, queue empty',
  (SELECT count(*) = 6 AND count(DISTINCT xid) = 6 FROM public.cq_log) AND NOT EXISTS (SELECT 1 FROM public.cq));
SELECT pg_temp.ok('the last chunk ran short and ended the loop', (SELECT took = 5 FROM public.cq_log ORDER BY id DESC LIMIT 1));
SELECT pg_temp.ok('the 2 s lock timeout is set in every chunk', (SELECT bool_and(lock_timeout = '2s') FROM public.cq_log));
TRUNCATE public.cq_log; INSERT INTO public.cq SELECT FROM generate_series(1, 300);
CALL public.drain_vehicle_completion_queue_chunked(7, 1000);
SELECT pg_temp.ok('chunk size is clamped to 100', (SELECT max(took) = 100 FROM public.cq_log));
SELECT pg_temp.ok('three jobs, each a lone CALL every minute, scheduled once',
  (SELECT count(*) = 3 AND bool_and(schedule = '* * * * *' AND command = 'CALL public.drain_vehicle_completion_queue_chunked(7, 25);') FROM cron.job));
SELECT pg_temp.ok('anon and authenticated cannot call it',
  NOT has_function_privilege('anon', 'public.drain_vehicle_completion_queue_chunked(integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.drain_vehicle_completion_queue_chunked(integer,integer)', 'EXECUTE'));
