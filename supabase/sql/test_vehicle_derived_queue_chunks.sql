-- Actual PG17 contracts for the chunked derived-queue drain (migration 20261006124500). Synthetic data only; never production.
-- The fixture installs the live prod bodies of drain_vehicle_derived_queues (PRE), drain_vehicle_completion_queue and
-- drain_vehicle_metric_queue, read 2026-10-06; their md5 fingerprints are asserted equal to prod's before the migration runs.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_derived_queue_chunks%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_derived_queue_chunks* PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE EXTENSION dblink;

-- Fixture tables: only the columns the drains touch.
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, completion_percentage integer, observation_count integer);
CREATE TABLE public.vehicle_observations(id bigserial PRIMARY KEY, vehicle_id uuid NOT NULL, kind text, observed_at timestamptz);
CREATE INDEX ON public.vehicle_observations(vehicle_id);
CREATE TABLE public.vehicle_live_metrics(vehicle_id uuid PRIMARY KEY, observation_count integer, comment_count integer,
  last_observation_at timestamptz, updated_at timestamptz);
CREATE TABLE public.vehicle_metric_recompute_queue(vehicle_id uuid PRIMARY KEY, live_metrics_dirty boolean NOT NULL DEFAULT false,
  observation_count_dirty boolean NOT NULL DEFAULT false, queued_at timestamptz NOT NULL DEFAULT now(),
  attempts smallint NOT NULL DEFAULT 0, last_error text);
CREATE TABLE public.vehicle_completion_recompute_queue(vehicle_id uuid PRIMARY KEY, queued_at timestamptz NOT NULL DEFAULT now(),
  attempts smallint NOT NULL DEFAULT 0, last_error text);
CREATE INDEX ON public.vehicle_completion_recompute_queue(queued_at);
-- Per-vehicle fixture behavior: fail the computation, fail the claim (whole-call failure), or sleep.
CREATE TABLE public.fixture_behavior(vehicle_id uuid PRIMARY KEY, fail boolean NOT NULL DEFAULT false,
  fail_claim boolean NOT NULL DEFAULT false, sleep_ms integer NOT NULL DEFAULT 0);
CREATE TABLE public.fixture_calls(id bigserial PRIMARY KEY, fn text NOT NULL, batch integer);

CREATE FUNCTION public.calculate_vehicle_completion_algorithmic(p_vehicle_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE b public.fixture_behavior;
BEGIN
  SELECT * INTO b FROM public.fixture_behavior WHERE vehicle_id = p_vehicle_id;
  IF b.sleep_ms > 0 THEN PERFORM pg_sleep(b.sleep_ms / 1000.0); END IF;
  IF b.fail THEN RAISE EXCEPTION 'synthetic completion failure'; END IF;
  RETURN jsonb_build_object('completion_percentage', 42);
END $$;
CREATE FUNCTION public.detect_field_conflicts(p_vehicle_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b public.fixture_behavior;
BEGIN
  SELECT * INTO b FROM public.fixture_behavior WHERE vehicle_id = p_vehicle_id;
  IF b.sleep_ms > 0 THEN PERFORM pg_sleep(b.sleep_ms / 1000.0); END IF;
  IF b.fail THEN RAISE EXCEPTION 'synthetic metric failure'; END IF;
END $$;
-- A claim that deletes a fail_claim row raises outside the drain's per-vehicle handler: a whole-call failure.
CREATE FUNCTION public.fixture_fail_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT fail_claim FROM public.fixture_behavior WHERE vehicle_id = OLD.vehicle_id) THEN
    RAISE EXCEPTION 'synthetic claim failure';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER fixture_fail_claim BEFORE DELETE ON public.vehicle_completion_recompute_queue
  FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_claim();
CREATE FUNCTION public.drain_vehicle_stats_queue(p_batch_size integer DEFAULT 50)
 RETURNS TABLE(processed integer, errored integer) LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.fixture_calls(fn, batch) VALUES ('stats', p_batch_size);
  IF current_setting('fixture.stats_fail', true) = '1' THEN RAISE EXCEPTION 'synthetic stats failure'; END IF;
  RETURN QUERY SELECT 0, 0;
END $$;
CREATE FUNCTION public.drain_vehicle_value_queue(p_batch_size integer DEFAULT 100)
 RETURNS TABLE(processed integer, errored integer) LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.fixture_calls(fn, batch) VALUES ('value', p_batch_size);
  RETURN QUERY SELECT 0, 0;
END $$;

-- Live prod bodies (pg_get_functiondef, 2026-10-06 11:46Z).
CREATE OR REPLACE FUNCTION public.drain_vehicle_completion_queue(p_batch_size integer DEFAULT 50)
 RETURNS TABLE(processed integer, errored integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  r record;
  n_processed int := 0;
  n_errored   int := 0;
  v_pct numeric;
  v_data jsonb;
BEGIN
  -- Tell the BEFORE UPDATE trigger to skip enqueueing on our writeback.
  -- set_config(..., true) = transaction-local. The trigger's
  -- current_setting('app.skip_completion_enqueue', true) reads it.
  PERFORM set_config('app.skip_completion_enqueue', '1', true);

  FOR r IN
    DELETE FROM public.vehicle_completion_recompute_queue
    WHERE vehicle_id IN (
      SELECT vehicle_id
      FROM public.vehicle_completion_recompute_queue
      ORDER BY queued_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    RETURNING vehicle_id
  LOOP
    BEGIN
      v_data := public.calculate_vehicle_completion_algorithmic(r.vehicle_id);
      IF v_data IS NOT NULL AND v_data ? 'completion_percentage' THEN
        v_pct := (v_data->>'completion_percentage')::numeric;
        UPDATE public.vehicles
        SET completion_percentage = ROUND(v_pct)::int
        WHERE id = r.vehicle_id
          AND completion_percentage IS DISTINCT FROM ROUND(v_pct)::int;
      END IF;
      n_processed := n_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      n_errored := n_errored + 1;
      INSERT INTO public.vehicle_completion_recompute_queue (vehicle_id, queued_at, attempts, last_error)
      VALUES (r.vehicle_id, now(), 1, SQLERRM)
      ON CONFLICT (vehicle_id) DO UPDATE SET
        attempts   = public.vehicle_completion_recompute_queue.attempts + 1,
        last_error = EXCLUDED.last_error,
        queued_at  = EXCLUDED.queued_at;
      DELETE FROM public.vehicle_completion_recompute_queue
      WHERE vehicle_id = r.vehicle_id AND attempts >= 3;
    END;
  END LOOP;

  RETURN QUERY SELECT n_processed, n_errored;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.drain_vehicle_metric_queue(p_batch_size integer DEFAULT 100)
 RETURNS TABLE(processed integer, errored integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r record; n_processed integer := 0; n_errored integer := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'metric drain batch size must be 1..1000' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    DELETE FROM public.vehicle_metric_recompute_queue
    WHERE vehicle_id IN (SELECT vehicle_id FROM public.vehicle_metric_recompute_queue
      ORDER BY queued_at,vehicle_id LIMIT p_batch_size FOR UPDATE SKIP LOCKED)
    RETURNING vehicle_id,live_metrics_dirty,observation_count_dirty,attempts
  LOOP
    BEGIN
      -- Match the direct fold's parent-first lock order before derived writes.
      PERFORM 1 FROM public.vehicles WHERE id = r.vehicle_id FOR UPDATE;
      IF r.observation_count_dirty THEN
        UPDATE public.vehicles v SET observation_count = (
          SELECT count(*) FROM public.vehicle_observations o WHERE o.vehicle_id = r.vehicle_id)
        WHERE v.id = r.vehicle_id;
      END IF;
      IF r.live_metrics_dirty THEN
        INSERT INTO public.vehicle_live_metrics
          (vehicle_id,observation_count,comment_count,last_observation_at,updated_at)
        SELECT r.vehicle_id,count(*),count(*) FILTER (WHERE kind = 'comment'),max(observed_at),now()
        FROM public.vehicle_observations WHERE vehicle_id = r.vehicle_id
        ON CONFLICT (vehicle_id) DO UPDATE SET
          observation_count = EXCLUDED.observation_count,comment_count = EXCLUDED.comment_count,
          last_observation_at = EXCLUDED.last_observation_at,updated_at = EXCLUDED.updated_at;
        PERFORM public.detect_field_conflicts(r.vehicle_id);
      END IF;
      n_processed := n_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      n_errored := n_errored + 1;
      INSERT INTO public.vehicle_metric_recompute_queue
        (vehicle_id,live_metrics_dirty,observation_count_dirty,queued_at,attempts,last_error)
      VALUES (r.vehicle_id,r.live_metrics_dirty,r.observation_count_dirty,now(),coalesce(r.attempts,0)+1,SQLERRM)
      ON CONFLICT (vehicle_id) DO UPDATE SET
        live_metrics_dirty = vehicle_metric_recompute_queue.live_metrics_dirty OR EXCLUDED.live_metrics_dirty,
        observation_count_dirty = vehicle_metric_recompute_queue.observation_count_dirty OR EXCLUDED.observation_count_dirty,
        attempts = greatest(vehicle_metric_recompute_queue.attempts,EXCLUDED.attempts),
        last_error = EXCLUDED.last_error,queued_at = EXCLUDED.queued_at;
      -- Keep failures visible/retryable; never drop an unmaterialized fold.
      RAISE WARNING 'metric fold failed for vehicle %, attempt %: %',r.vehicle_id,coalesce(r.attempts,0)+1,SQLERRM;
    END;
  END LOOP;
  RETURN QUERY SELECT n_processed,n_errored;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.drain_vehicle_derived_queues(p_include_value boolean DEFAULT false, p_budget_seconds integer DEFAULT 45)
 RETURNS TABLE(queue text, processed integer, errored integer, skipped boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => p_budget_seconds);
  v_p    integer;
  v_e    integer;
  v_name text;
BEGIN
  -- The drains' writebacks must not re-enqueue completion recomputes (update_vehicle_completion reads this).
  PERFORM set_config('app.skip_completion_enqueue', '1', true);

  FOREACH v_name IN ARRAY ARRAY['metric', 'completion', 'stats', 'value'] LOOP
    queue := v_name; processed := 0; errored := 0; skipped := false;

    IF v_name = 'value' AND NOT p_include_value THEN
      skipped := true;                       -- off until the sale data is clean
    ELSIF clock_timestamp() >= v_deadline THEN
      skipped := true;                       -- budget spent; the next run continues
    ELSE
      BEGIN
        v_p := NULL; v_e := NULL;
        CASE v_name
          WHEN 'metric'     THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_metric_queue(100) d;
          WHEN 'completion' THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_completion_queue(50) d;
          WHEN 'stats'      THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_stats_queue(50) d;
          WHEN 'value'      THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_value_queue(100) d;
        END CASE;
        processed := coalesce(v_p, 0);
        errored   := coalesce(v_e, 0);
      EXCEPTION
        WHEN query_canceled THEN
          RAISE;                             -- the job's own budget fired; fail loudly, do not swallow
        WHEN OTHERS THEN
          errored := -1;                     -- whole-drain failure (distinct from per-vehicle errors)
          RAISE WARNING 'drain_vehicle_%_queue failed: %', v_name, SQLERRM;
      END;
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$function$
;

REVOKE ALL ON FUNCTION public.drain_vehicle_derived_queues(boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_vehicle_derived_queues(boolean, integer) TO service_role;

CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
RAISE NOTICE 'PASS: %', label; END $$;
-- n vehicles v1..vn, queued at 2026-01-01 + i seconds, so the claim order is the vehicle number.
CREATE FUNCTION pg_temp.vid(i integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.reset_fixture(n_completion integer, n_metric integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE public.vehicle_completion_recompute_queue, public.vehicle_metric_recompute_queue, public.fixture_calls,
    public.vehicle_live_metrics, public.vehicle_observations;
  UPDATE public.fixture_behavior SET fail = false, fail_claim = false, sleep_ms = 0;
  UPDATE public.vehicles SET completion_percentage = NULL, observation_count = NULL;
  INSERT INTO public.vehicle_completion_recompute_queue(vehicle_id, queued_at)
    SELECT pg_temp.vid(i), '2026-01-01T00:00:00Z'::timestamptz + make_interval(secs => i) FROM generate_series(1, n_completion) i;
  INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id, live_metrics_dirty, observation_count_dirty, queued_at)
    SELECT pg_temp.vid(i), true, true, '2026-01-01T00:00:00Z'::timestamptz + make_interval(secs => i) FROM generate_series(1, n_metric) i;
END $$;
INSERT INTO public.vehicles(id) SELECT pg_temp.vid(i) FROM generate_series(1, 3000) i;
INSERT INTO public.fixture_behavior(vehicle_id) SELECT id FROM public.vehicles;

-- PRE: the fixture holds the live bodies.
SELECT pg_temp.assert_true(
  md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure)) = 'a31ee089871fefb2b1896a0bdad83027' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND md5(pg_get_functiondef('public.drain_vehicle_completion_queue(integer)'::regprocedure)) = '60882c706b57faca9e2434081eb04a99' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND md5(pg_get_functiondef('public.drain_vehicle_metric_queue(integer)'::regprocedure)) = '1eea08769907469a5fc71377de2de3fc', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'Fixture bodies hash to the live prod fingerprints read 2026-10-06');

-- Negative control: the live body drains 50 completion rows and 100 metric rows per run.
SELECT pg_temp.reset_fixture(2500, 300);
CREATE TEMP TABLE pre_run AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 50 FROM pre_run WHERE queue = 'completion')
  AND (SELECT processed = 100 FROM pre_run WHERE queue = 'metric')
  AND (SELECT count(*) = 2450 FROM public.vehicle_completion_recompute_queue),
  'Live body is capped at 50 completion and 100 metric rows per run');

CREATE TEMP TABLE pre_contract AS SELECT oid, proacl, proowner, prosecdef, proconfig
  FROM pg_proc WHERE oid = 'public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure;
\ir ../migrations/20261006124500_derived_queue_drain_chunks.sql
SELECT pg_temp.assert_true(
  md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure)) = '6e01a654bbff1503d8148d8e3d216f25', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'Migration installs the POST body');
SELECT pg_temp.assert_true((SELECT o.proacl IS NOT DISTINCT FROM p.proacl AND o.proowner = p.proowner
  AND o.prosecdef = p.prosecdef AND o.proconfig IS NOT DISTINCT FROM p.proconfig
  FROM pre_contract o JOIN pg_proc p USING (oid)), 'Owner, ACL, invoker and config preserved in place');
\ir ../migrations/20261006124500_derived_queue_drain_chunks.sql
SELECT pg_temp.assert_true(
  md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure)) = '6e01a654bbff1503d8148d8e3d216f25', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'Replay of the migration is a no-op');
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.drain_vehicle_completion_queue(integer)'::regprocedure)) = '60882c706b57faca9e2434081eb04a99' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND md5(pg_get_functiondef('public.drain_vehicle_metric_queue(integer)'::regprocedure)) = '1eea08769907469a5fc71377de2de3fc', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'Inner drains are untouched');

-- Drift: a body that is neither PRE nor POST refuses the migration.
CREATE TEMP TABLE post_def AS SELECT pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure) d;
COMMENT ON FUNCTION public.drain_vehicle_derived_queues(boolean, integer) IS 'comment does not change the fingerprint';
DO $$ BEGIN
  EXECUTE replace((SELECT d FROM post_def), 'chunk = rows per inner call', 'chunk = rows per inner call (drifted)');
END $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261006124500_derived_queue_drain_chunks.sql
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure)) NOT IN
  ('6e01a654bbff1503d8148d8e3d216f25', 'a31ee089871fefb2b1896a0bdad83027'), -- gitleaks:allow (function-definition fingerprint, not a secret)
  'A drifted body makes the migration refuse (body left as found)');
DO $$ BEGIN EXECUTE (SELECT d FROM post_def); END $$;
SELECT pg_temp.assert_true(
  md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure)) = '6e01a654bbff1503d8148d8e3d216f25', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'POST body restored for the behavior contracts');

-- 1. Caps: 2,500 completion and 800 metric rows; one run drains 1,000 and 500.
SELECT pg_temp.reset_fixture(2500, 800);
CREATE TEMP TABLE r1 AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 1000 AND errored = 0 AND NOT skipped FROM r1 WHERE queue = 'completion')
  AND (SELECT count(*) = 1500 FROM public.vehicle_completion_recompute_queue)
  AND (SELECT min(queued_at) = '2026-01-01T00:00:00Z'::timestamptz + interval '1001 seconds' FROM public.vehicle_completion_recompute_queue),
  'Completion drains 1,000 rows per run, oldest first');
SELECT pg_temp.assert_true((SELECT processed = 500 AND errored = 0 FROM r1 WHERE queue = 'metric')
  AND (SELECT count(*) = 300 FROM public.vehicle_metric_recompute_queue)
  AND (SELECT count(*) = 500 FROM public.vehicle_live_metrics),
  'Metric drains 500 rows per run in chunks of 25');
SELECT pg_temp.assert_true((SELECT count(*) = 1000 FROM public.vehicles WHERE completion_percentage = 42),
  'Each drained completion row writes its value');
SELECT pg_temp.assert_true((SELECT skipped FROM r1 WHERE queue = 'value')
  AND (SELECT count(*) = 1 AND min(batch) = 50 FROM public.fixture_calls WHERE fn = 'stats')
  AND NOT EXISTS (SELECT 1 FROM public.fixture_calls WHERE fn = 'value'),
  'Stats makes one call of 50; value stays off without p_include_value');

-- 2. A short queue ends the loop.
SELECT pg_temp.reset_fixture(30, 7);
CREATE TEMP TABLE r2 AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 30 FROM r2 WHERE queue = 'completion')
  AND (SELECT processed = 7 FROM r2 WHERE queue = 'metric')
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_completion_recompute_queue)
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_metric_recompute_queue),
  'Short queues drain to empty and stop');

-- 3. A failed completion row ends the completion loop after its chunk; it gets one attempt this run.
SELECT pg_temp.reset_fixture(200, 0);
UPDATE public.fixture_behavior SET fail = true WHERE vehicle_id = pg_temp.vid(60);
CREATE TEMP TABLE r3 AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 99 AND errored = 1 FROM r3 WHERE queue = 'completion')
  AND (SELECT attempts = 1 AND last_error = 'synthetic completion failure' FROM public.vehicle_completion_recompute_queue
       WHERE vehicle_id = pg_temp.vid(60))
  AND (SELECT count(*) = 101 FROM public.vehicle_completion_recompute_queue),
  'Completion failure: chunk 2 finishes, the loop stops, the failed row has one attempt');

-- 4. A failed metric row ends the metric loop; the metric drain keeps it (never drops a fold).
SELECT pg_temp.reset_fixture(0, 100);
UPDATE public.fixture_behavior SET fail = true WHERE vehicle_id = pg_temp.vid(10);
CREATE TEMP TABLE r4 AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 24 AND errored = 1 FROM r4 WHERE queue = 'metric')
  AND (SELECT attempts = 1 FROM public.vehicle_metric_recompute_queue WHERE vehicle_id = pg_temp.vid(10))
  AND (SELECT count(*) = 76 FROM public.vehicle_metric_recompute_queue),
  'Metric failure: the loop stops after chunk 1 and the failed fold stays queued with one attempt');

-- 5. A whole-call failure keeps the earlier chunks of the same queue and later queues still run.
SELECT pg_temp.reset_fixture(200, 0);
UPDATE public.fixture_behavior SET fail_claim = true WHERE vehicle_id = pg_temp.vid(70);
CREATE TEMP TABLE r5 AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 50 AND errored = -1 FROM r5 WHERE queue = 'completion')
  AND (SELECT count(*) = 150 FROM public.vehicle_completion_recompute_queue)
  AND (SELECT min(queued_at) = '2026-01-01T00:00:00Z'::timestamptz + interval '51 seconds' FROM public.vehicle_completion_recompute_queue)
  AND (SELECT count(*) = 1 FROM public.fixture_calls WHERE fn = 'stats'),
  'Whole-call failure in chunk 2 keeps chunk 1, restores chunk 2 and reports -1');
SELECT pg_temp.reset_fixture(60, 0);
SET fixture.stats_fail = '1';
CREATE TEMP TABLE r5b AS SELECT * FROM public.drain_vehicle_derived_queues();
RESET fixture.stats_fail;
SELECT pg_temp.assert_true((SELECT errored = -1 FROM r5b WHERE queue = 'stats')
  AND (SELECT processed = 60 FROM r5b WHERE queue = 'completion')
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_completion_recompute_queue),
  'A failing queue does not roll back the queues before it');

-- 6. Time budget: no chunk starts after 2/3 of the budget.
SELECT pg_temp.reset_fixture(1000, 0);
UPDATE public.fixture_behavior SET sleep_ms = 20;  -- 50 rows = 1 s per completion chunk
CREATE TEMP TABLE t6 AS SELECT clock_timestamp() t0;
CREATE TEMP TABLE r6 AS SELECT * FROM public.drain_vehicle_derived_queues(false, 3);
SELECT pg_temp.assert_true((SELECT processed BETWEEN 100 AND 150 FROM r6 WHERE queue = 'completion')
  AND (SELECT clock_timestamp() - t0 < interval '3.5 seconds' FROM t6),
  'Budget 3 s: completion stops starting chunks at 2 s and the run ends inside the budget');
SELECT pg_temp.reset_fixture(500, 200);
UPDATE public.fixture_behavior SET sleep_ms = 30;  -- 25 metric rows = 0.75 s per chunk
CREATE TEMP TABLE r6b AS SELECT * FROM public.drain_vehicle_derived_queues(false, 3);
SELECT pg_temp.assert_true((SELECT processed BETWEEN 50 AND 100 FROM r6b WHERE queue = 'metric')
  AND (SELECT skipped AND processed = 0 FROM r6b WHERE queue = 'completion')
  AND (SELECT count(*) = 500 FROM public.vehicle_completion_recompute_queue),
  'A metric burst spends the budget and completion waits for the next run');

-- 7. The job's statement_timeout still cancels the run and rolls it back (query_canceled is not swallowed).
SELECT pg_temp.reset_fixture(1000, 0);
UPDATE public.fixture_behavior SET sleep_ms = 20;
SELECT dblink_connect('cancel_probe', format('host=%s port=%s dbname=%s user=%s',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
SELECT dblink_exec('cancel_probe', 'SET statement_timeout = ''500ms''');
SELECT pg_temp.assert_true(dblink_exec('cancel_probe', 'SELECT * FROM public.drain_vehicle_derived_queues()', false) = 'ERROR'
  AND dblink_error_message('cancel_probe') LIKE '%statement timeout%'
  AND (SELECT count(*) = 1000 FROM public.vehicle_completion_recompute_queue),
  'statement_timeout cancels the run and its claims roll back');
SELECT dblink_disconnect('cancel_probe');

-- 8. A vehicles row held by another backend fails that one vehicle after 5 s; the run completes.
SELECT pg_temp.reset_fixture(20, 0);
SELECT dblink_connect('lock_holder', format('host=%s port=%s dbname=%s user=%s',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
SELECT dblink_exec('lock_holder', 'BEGIN');
SELECT * FROM dblink('lock_holder', format('SELECT 1 FROM public.vehicles WHERE id = %L FOR UPDATE', pg_temp.vid(5))) AS held(x integer);
CREATE TEMP TABLE t8 AS SELECT clock_timestamp() t0;
CREATE TEMP TABLE r8 AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 19 AND errored = 1 FROM r8 WHERE queue = 'completion')
  AND (SELECT last_error LIKE '%lock timeout%' AND attempts = 1 FROM public.vehicle_completion_recompute_queue
       WHERE vehicle_id = pg_temp.vid(5))
  AND (SELECT clock_timestamp() - t0 BETWEEN interval '4.5 seconds' AND interval '15 seconds' FROM t8),
  'Locked vehicle fails after the 5 s lock_timeout and is re-queued; the other 19 are written');
SELECT pg_temp.assert_true(current_setting('lock_timeout') = '0',
  'lock_timeout is transaction-local and resets after the run');
SELECT dblink_exec('lock_holder', 'ROLLBACK');
SELECT dblink_disconnect('lock_holder');
