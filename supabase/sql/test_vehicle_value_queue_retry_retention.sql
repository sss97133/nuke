-- Actual PG17 retry/retention contracts. Synthetic data only; never production.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_value_retry%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_value_retry* PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_value_recompute_queue(
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id),
  queued_at timestamptz NOT NULL DEFAULT now(), attempts smallint NOT NULL DEFAULT 0, last_error text);
CREATE INDEX idx_fixture_queue_at ON public.vehicle_value_recompute_queue(queued_at);
CREATE TABLE public.fixture_behavior(vehicle_id uuid PRIMARY KEY, should_fail boolean NOT NULL);
CREATE TABLE public.fixture_outputs(vehicle_id uuid PRIMARY KEY, result integer NOT NULL);
CREATE FUNCTION public.compute_vehicle_value(target uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.fixture_outputs VALUES(target,1);
  IF (SELECT should_fail FROM public.fixture_behavior WHERE vehicle_id=target) THEN
    RAISE EXCEPTION 'synthetic computation failure';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.drain_vehicle_value_queue(p_batch_size integer DEFAULT 100)
 RETURNS TABLE(processed integer, errored integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  r record;
  n_processed int := 0;
  n_errored   int := 0;
BEGIN
  PERFORM set_config('app.skip_completion_enqueue', '1', true);
  FOR r IN
    DELETE FROM public.vehicle_value_recompute_queue
    WHERE vehicle_id IN (
      SELECT vehicle_id
      FROM public.vehicle_value_recompute_queue
      ORDER BY queued_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    RETURNING vehicle_id
  LOOP
    BEGIN
      PERFORM public.compute_vehicle_value(r.vehicle_id);
      n_processed := n_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      n_errored := n_errored + 1;
      INSERT INTO public.vehicle_value_recompute_queue (vehicle_id, queued_at, attempts, last_error)
      VALUES (r.vehicle_id, now(), 1, SQLERRM)
      ON CONFLICT (vehicle_id) DO UPDATE SET
        attempts   = public.vehicle_value_recompute_queue.attempts + 1,
        last_error = EXCLUDED.last_error,
        queued_at  = EXCLUDED.queued_at;
      DELETE FROM public.vehicle_value_recompute_queue
      WHERE vehicle_id = r.vehicle_id AND attempts >= 3;
    END;
  END LOOP;

  RETURN QUERY SELECT n_processed, n_errored;
END;
$function$;

REVOKE ALL ON FUNCTION public.drain_vehicle_value_queue(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.drain_vehicle_value_queue(integer) TO service_role;
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
RAISE NOTICE 'PASS: %',label; END $$;
INSERT INTO public.vehicles SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,2200) i;
INSERT INTO public.fixture_behavior SELECT id,false FROM public.vehicles;
UPDATE public.fixture_behavior SET should_fail=true WHERE vehicle_id='00000000-0000-4000-8000-000000000001';
INSERT INTO public.vehicle_value_recompute_queue VALUES
 ('00000000-0000-4000-8000-000000000001','2026-01-01T00:00:00Z',0,NULL);
SELECT * FROM public.drain_vehicle_value_queue(1);
SELECT * FROM public.drain_vehicle_value_queue(1);
SELECT pg_temp.assert_true((SELECT attempts=1 FROM public.vehicle_value_recompute_queue),
 'Actual original function resets retry count to1 after repeated failures');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.fixture_outputs),
 'Failed computation writes roll back in actual original function');
CREATE TEMP TABLE old_contract AS SELECT proacl,proowner,prosecdef,proconfig,oid
 FROM pg_proc WHERE oid='public.drain_vehicle_value_queue(integer)'::regprocedure;
TRUNCATE public.vehicle_value_recompute_queue;
INSERT INTO public.vehicle_value_recompute_queue VALUES
 ('00000000-0000-4000-8000-000000000001','2026-01-01T00:00:00Z',0,NULL),
 ('00000000-0000-4000-8000-000000000002','2026-01-02T00:00:00Z',0,NULL);
\ir ../migrations/20261004093057_vehicle_value_queue_retry_retention.sql
CREATE TEMP TABLE repaired_contract AS SELECT pg_get_functiondef(oid) definition
 FROM pg_proc WHERE oid='public.drain_vehicle_value_queue(integer)'::regprocedure;
\ir ../migrations/20261004093057_vehicle_value_queue_retry_retention.sql
SELECT pg_temp.assert_true((SELECT o.proacl IS NOT DISTINCT FROM p.proacl
 AND o.proowner=p.proowner AND o.prosecdef=p.prosecdef AND o.proconfig IS NOT DISTINCT FROM p.proconfig
 AND pg_get_functiondef(p.oid)=r.definition FROM old_contract o JOIN pg_proc p USING(oid)
 CROSS JOIN repaired_contract r),'Migration preserves owner/ACL/invoker/config and exact body on replay');
SELECT pg_temp.assert_true((SELECT processed=1 AND errored=1 FROM public.drain_vehicle_value_queue(2)),
 'Mixed batch reports one successful and one failed computation');
SELECT pg_temp.assert_true((SELECT attempts=1 AND last_error='synthetic computation failure'
 AND queued_at='2026-01-01T00:00:00Z' FROM public.vehicle_value_recompute_queue
 WHERE vehicle_id='00000000-0000-4000-8000-000000000001'),
 'First failure retains source queue clock and exact error');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.vehicle_value_recompute_queue
 WHERE vehicle_id='00000000-0000-4000-8000-000000000002')
 AND EXISTS(SELECT 1 FROM public.fixture_outputs
 WHERE vehicle_id='00000000-0000-4000-8000-000000000002'),
 'Successful calculation commits its output and removes only completed work');
SELECT * FROM public.drain_vehicle_value_queue(1);
SELECT pg_temp.assert_true((SELECT attempts=2 FROM public.vehicle_value_recompute_queue),
 'Second failure advances preserved attempt count');
SELECT * FROM public.drain_vehicle_value_queue(1);
SELECT pg_temp.assert_true((SELECT attempts=3 AND last_error IS NOT NULL FROM public.vehicle_value_recompute_queue),
 'Third failure remains visible at retry ceiling rather than being deleted');
SELECT pg_temp.assert_true((SELECT processed=0 AND errored=0 FROM public.drain_vehicle_value_queue(100))
 AND (SELECT attempts=3 FROM public.vehicle_value_recompute_queue),
 'Later drain skips retained retry-ceiling work');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.fixture_outputs
 WHERE vehicle_id='00000000-0000-4000-8000-000000000001'),
 'Replacement rolls back partial calculation writes on every failure');
INSERT INTO public.vehicle_value_recompute_queue(vehicle_id,queued_at)
 SELECT id,'2026-02-01T00:00:00Z' FROM public.vehicles WHERE id::text NOT LIKE '%000000000001'
 AND id::text NOT LIKE '%000000000002';
SELECT pg_temp.assert_true((SELECT processed=0 AND errored=0 FROM public.drain_vehicle_value_queue(-1))
 AND (SELECT processed=0 AND errored=0 FROM public.drain_vehicle_value_queue(0)),
 'Nonpositive batch sizes do not drain work');
SELECT pg_temp.assert_true((SELECT processed=100 AND errored=0 FROM public.drain_vehicle_value_queue(NULL)),
 'NULL input uses existing100default rather than becoming unbounded');
CREATE TEMP TABLE oversized_result AS SELECT * FROM public.drain_vehicle_value_queue(200000);
SELECT pg_temp.assert_true((SELECT processed=1000 AND errored=0 FROM oversized_result)
 AND (SELECT count(*)=1099 FROM public.vehicle_value_recompute_queue),
 'Oversized request remains bounded and does not touch retained failure');
-- Actual second backend holds the first eligible row; the worker must skip it.
CREATE EXTENSION dblink;
SELECT dblink_connect('queue_fixture_lock',format('host=%s port=%s dbname=%s user=%s',
 split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_database(),current_user));
SELECT dblink_exec('queue_fixture_lock','BEGIN');
SELECT * FROM dblink('queue_fixture_lock',
 'SELECT vehicle_id FROM public.vehicle_value_recompute_queue WHERE attempts<3 ORDER BY queued_at,vehicle_id LIMIT 1 FOR UPDATE')
 AS locked(id uuid);
CREATE TEMP TABLE concurrent_result AS SELECT * FROM public.drain_vehicle_value_queue(1);
SELECT pg_temp.assert_true((SELECT processed=1 AND errored=0 FROM concurrent_result)
 AND EXISTS(SELECT 1 FROM public.vehicle_value_recompute_queue
 WHERE vehicle_id='00000000-0000-4000-8000-000000001103')
 AND EXISTS(SELECT 1 FROM public.fixture_outputs
 WHERE vehicle_id='00000000-0000-4000-8000-000000001104'),
 'Actual concurrently locked oldest row is skipped while next available work succeeds');
SELECT dblink_exec('queue_fixture_lock','ROLLBACK');
SELECT dblink_disconnect('queue_fixture_lock');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.drain_vehicle_value_queue(integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.drain_vehicle_value_queue(integer)','EXECUTE')
 AND has_function_privilege('service_role','public.drain_vehicle_value_queue(integer)','EXECUTE'),
 'Public/authenticated execution stays denied and existing service execution retained');
SELECT 'PASS: actual original-regression and retry retention contracts' result;
