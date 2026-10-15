-- Isolated PostgreSQL 17 contract for drain_vehicle_derived_queues_chunked (20261015092000). Synthetic stand-ins for the four
-- inner drains; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_drain_chunked && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_drain_chunked -f supabase/sql/test_drain_vehicle_queues_chunked.sql
-- Covered: every chunk runs in its own transaction (distinct txids logged by the stand-ins); the slice order and the
-- chunk sizes; value stays off unless asked; the cap and the short-run exit; a failing inner drain stops that queue and
-- not the others; the budget clamp; the job is rewritten to a lone CALL every minute; the ACL.
-- Not covered: pg_cron itself (a stub cron schema), the real inner drains, and lock behaviour between sessions, which was
-- measured by hand on PostgreSQL 17 with two sessions.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.drain_log') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigint PRIMARY KEY, jobname text, schedule text, command text, active boolean);
INSERT INTO cron.job VALUES (500, 'drain-vehicle-derived-queues', '*/2 * * * *', 'old', true);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ UPDATE cron.job SET schedule = coalesce($2, schedule), command = coalesce($3, command) WHERE jobid = $1 $$;

CREATE TABLE public.drain_log (id serial PRIMARY KEY, queue text, chunk integer, xid bigint, lock_timeout text, skip text);
CREATE TABLE public.drain_backlog (queue text PRIMARY KEY, n integer);
INSERT INTO public.drain_backlog VALUES ('metric', 35), ('stats', 120), ('value', 500), ('completion', 40);
CREATE TABLE public.drain_failing (queue text);

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

\ir ../migrations/20261015092000_drain_vehicle_queues_chunked.sql
\ir ../migrations/20261015092000_drain_vehicle_queues_chunked.sql

-- stand-in for the four inner drains: a full chunk while the backlog lasts, logging the transaction it ran in
CREATE FUNCTION public.drain_stub(p_queue text, p_chunk integer) RETURNS TABLE (processed integer, errored integer)
LANGUAGE plpgsql AS $$
DECLARE have integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.drain_failing WHERE queue = p_queue) THEN RAISE EXCEPTION 'stub failure %', p_queue; END IF;
  SELECT n INTO have FROM public.drain_backlog WHERE queue = p_queue;
  processed := least(have, p_chunk); errored := 0;
  UPDATE public.drain_backlog SET n = n - processed WHERE queue = p_queue;
  INSERT INTO public.drain_log (queue, chunk, xid, lock_timeout, skip)
    VALUES (p_queue, p_chunk, txid_current(), current_setting('lock_timeout'), current_setting('app.skip_completion_enqueue', true));
  RETURN NEXT;
END $$;

CREATE FUNCTION public.drain_vehicle_metric_queue(p integer) RETURNS TABLE (processed integer, errored integer) LANGUAGE sql AS $$ SELECT * FROM public.drain_stub('metric', p) $$;
CREATE FUNCTION public.drain_vehicle_stats_queue(p integer) RETURNS TABLE (processed integer, errored integer) LANGUAGE sql AS $$ SELECT * FROM public.drain_stub('stats', p) $$;
CREATE FUNCTION public.drain_vehicle_value_queue(p integer) RETURNS TABLE (processed integer, errored integer) LANGUAGE sql AS $$ SELECT * FROM public.drain_stub('value', p) $$;
CREATE FUNCTION public.drain_vehicle_completion_queue(p integer) RETURNS TABLE (processed integer, errored integer) LANGUAGE sql AS $$ SELECT * FROM public.drain_stub('completion', p) $$;

CALL public.drain_vehicle_derived_queues_chunked(false, 9);

SELECT pg_temp.ok('metric 35 rows in chunks of 10: 4 chunks, 4 transactions',
  (SELECT count(*) = 4 AND count(DISTINCT xid) = 4 FROM public.drain_log WHERE queue = 'metric'));
SELECT pg_temp.ok('stats makes one call of 50 and completion chunks of 25 rows',
  (SELECT count(*) = 1 FROM public.drain_log WHERE queue = 'stats')
  AND (SELECT count(*) = 2 AND bool_and(chunk = 25) FROM public.drain_log WHERE queue = 'completion'));
SELECT pg_temp.ok('value stays off', NOT EXISTS (SELECT 1 FROM public.drain_log WHERE queue = 'value'));
SELECT pg_temp.ok('the slice order is metric, stats, completion',
  (SELECT string_agg(DISTINCT queue, ',' ORDER BY queue) = 'completion,metric,stats' FROM public.drain_log)
  AND (SELECT min(id) FROM public.drain_log WHERE queue = 'metric') < (SELECT min(id) FROM public.drain_log WHERE queue = 'stats')
  AND (SELECT min(id) FROM public.drain_log WHERE queue = 'stats') < (SELECT min(id) FROM public.drain_log WHERE queue = 'completion'));
SELECT pg_temp.ok('the 2 s lock timeout and the completion-enqueue skip are set in every chunk, after every commit',
  (SELECT bool_and(lock_timeout = '2s' AND skip = '1') FROM public.drain_log));
SELECT pg_temp.ok('no chunk shares a transaction with another', (SELECT count(*) = count(DISTINCT xid) FROM public.drain_log));

-- a failing inner drain stops that queue only
TRUNCATE public.drain_log;
UPDATE public.drain_backlog SET n = 100 WHERE queue IN ('metric', 'stats', 'completion');
INSERT INTO public.drain_failing VALUES ('stats');
CALL public.drain_vehicle_derived_queues_chunked(false, 9);
SELECT pg_temp.ok('a failing stats drain does not stop metric or completion',
  EXISTS (SELECT 1 FROM public.drain_log WHERE queue = 'metric') AND EXISTS (SELECT 1 FROM public.drain_log WHERE queue = 'completion')
  AND NOT EXISTS (SELECT 1 FROM public.drain_log WHERE queue = 'stats'));
DELETE FROM public.drain_failing;

-- value on
TRUNCATE public.drain_log;
UPDATE public.drain_backlog SET n = 500;
CALL public.drain_vehicle_derived_queues_chunked(true, 9);
SELECT pg_temp.ok('value runs when asked', EXISTS (SELECT 1 FROM public.drain_log WHERE queue = 'value'));

-- the budget clamp
SELECT pg_temp.ok('budget is clamped to 5..9 s in the text of the procedure',
  (SELECT prosrc LIKE '%least(greatest(coalesce(p_budget_seconds, 8), 5), 9)%' FROM pg_proc WHERE proname = 'drain_vehicle_derived_queues_chunked'));
SELECT pg_temp.ok('job 500 is a lone CALL every minute',
  (SELECT schedule = '* * * * *' AND command = 'CALL public.drain_vehicle_derived_queues_chunked(false, 8);' FROM cron.job WHERE jobid = 500));
SELECT pg_temp.ok('anon and authenticated cannot call it',
  NOT has_function_privilege('anon', 'public.drain_vehicle_derived_queues_chunked(boolean,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.drain_vehicle_derived_queues_chunked(boolean,integer)', 'EXECUTE'));
