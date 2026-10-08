-- Actual PG17 contracts for migration 20261006124500 (chunked derived-queue drain, completion retry count). Synthetic data only; never production.
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

-- Fingerprints of the bodies before (prod, 2026-10-06) and after this migration.
CREATE FUNCTION pg_temp.md5_derived() RETURNS text LANGUAGE sql AS
$$ SELECT md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure)) $$;
CREATE FUNCTION pg_temp.md5_completion() RETURNS text LANGUAGE sql AS
$$ SELECT md5(pg_get_functiondef('public.drain_vehicle_completion_queue(integer)'::regprocedure)) $$;
CREATE FUNCTION pg_temp.md5_metric() RETURNS text LANGUAGE sql AS
$$ SELECT md5(pg_get_functiondef('public.drain_vehicle_metric_queue(integer)'::regprocedure)) $$;

-- PRE: the fixture holds the live bodies.
SELECT pg_temp.assert_true(pg_temp.md5_derived() = 'a31ee089871fefb2b1896a0bdad83027' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND pg_temp.md5_completion() = '60882c706b57faca9e2434081eb04a99' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND pg_temp.md5_metric() = '1eea08769907469a5fc71377de2de3fc', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'Fixture bodies hash to the live prod fingerprints read 2026-10-06');

-- Negative controls on the live bodies.
SELECT pg_temp.reset_fixture(2500, 300);
CREATE TEMP TABLE pre_run AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 50 FROM pre_run WHERE queue = 'completion')
  AND (SELECT processed = 100 FROM pre_run WHERE queue = 'metric')
  AND (SELECT count(*) = 2450 FROM public.vehicle_completion_recompute_queue),
  'Live body is capped at 50 completion and 100 metric rows per run');
SELECT pg_temp.reset_fixture(1, 0);
UPDATE public.fixture_behavior SET fail = true WHERE vehicle_id = pg_temp.vid(1);
SELECT * FROM public.drain_vehicle_derived_queues();
SELECT * FROM public.drain_vehicle_derived_queues();
SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT attempts = 1 FROM public.vehicle_completion_recompute_queue WHERE vehicle_id = pg_temp.vid(1)),
  'Live completion drain resets a poison row to attempts 1 every run, so the attempts >= 3 purge never fires');

CREATE TEMP TABLE pre_contract AS SELECT oid, proacl, proowner, prosecdef, proconfig FROM pg_proc
  WHERE oid IN ('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure, 'public.drain_vehicle_completion_queue(integer)'::regprocedure);
\ir ../migrations/20261006124500_derived_queue_drain_chunks.sql
SELECT pg_temp.assert_true(pg_temp.md5_derived() = '8a90f979b6556121efc905b8e6d44fc6' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND pg_temp.md5_completion() = 'f78c859a15440aed6ce40531333274a7', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'Migration installs both POST bodies');
SELECT pg_temp.assert_true((SELECT count(*) = 2 AND bool_and(o.proacl IS NOT DISTINCT FROM p.proacl AND o.proowner = p.proowner
  AND o.prosecdef = p.prosecdef AND o.proconfig IS NOT DISTINCT FROM p.proconfig)
  FROM pre_contract o JOIN pg_proc p USING (oid)), 'Owner, ACL, invoker and config preserved in place for both functions');
\ir ../migrations/20261006124500_derived_queue_drain_chunks.sql
SELECT pg_temp.assert_true(pg_temp.md5_derived() = '8a90f979b6556121efc905b8e6d44fc6' -- gitleaks:allow (function-definition fingerprint, not a secret)
  AND pg_temp.md5_completion() = 'f78c859a15440aed6ce40531333274a7', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'Replay of the migration is a no-op');
SELECT pg_temp.assert_true(pg_temp.md5_metric() = '1eea08769907469a5fc71377de2de3fc', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'Metric drain is untouched');

-- Drift: a body that is neither PRE nor POST refuses the migration and is left as found.
CREATE TEMP TABLE post_def AS SELECT pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure) d;
DO $$ BEGIN
  EXECUTE replace((SELECT d FROM post_def), 'chunk = rows per inner call', 'chunk = rows per inner call (drifted)');
END $$;
CREATE TEMP TABLE drifted AS SELECT pg_temp.md5_derived() m;
\set ON_ERROR_STOP off
\ir ../migrations/20261006124500_derived_queue_drain_chunks.sql
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(pg_temp.md5_derived() = (SELECT m FROM drifted)
  AND pg_temp.md5_derived() NOT IN ('8a90f979b6556121efc905b8e6d44fc6', 'a31ee089871fefb2b1896a0bdad83027'), -- gitleaks:allow (function-definition fingerprint, not a secret)
  'A drifted body makes the migration refuse and stays as found');
DO $$ BEGIN EXECUTE (SELECT d FROM post_def); END $$;
SELECT pg_temp.assert_true(pg_temp.md5_derived() = '8a90f979b6556121efc905b8e6d44fc6', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'POST body restored for the behavior contracts');

-- 1. Caps: one run drains 1,000 completion and 500 metric rows; stats makes one call; value stays off.
SELECT pg_temp.reset_fixture(2500, 800);
CREATE TEMP TABLE r1 AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 1000 AND errored = 0 AND NOT skipped FROM r1 WHERE queue = 'completion')
  AND (SELECT count(*) = 1500 FROM public.vehicle_completion_recompute_queue)
  AND (SELECT min(queued_at) = '2026-01-01T00:00:00Z'::timestamptz + interval '1001 seconds' FROM public.vehicle_completion_recompute_queue),
  'Completion drains 1,000 rows per run, oldest first');
SELECT pg_temp.assert_true((SELECT processed = 500 AND errored = 0 FROM r1 WHERE queue = 'metric')
  AND (SELECT count(*) = 300 FROM public.vehicle_metric_recompute_queue)
  AND (SELECT count(*) = 500 FROM public.vehicle_live_metrics),
  'Metric drains 500 rows per run in chunks of 10');
SELECT pg_temp.assert_true((SELECT count(*) = 1000 FROM public.vehicles WHERE completion_percentage = 42),
  'Each drained completion row writes its value');
SELECT pg_temp.assert_true((SELECT skipped FROM r1 WHERE queue = 'value')
  AND (SELECT count(*) = 1 AND min(batch) = 50 FROM public.fixture_calls WHERE fn = 'stats')
  AND NOT EXISTS (SELECT 1 FROM public.fixture_calls WHERE fn = 'value')
  AND (SELECT string_agg(queue, ',') = 'metric,stats,value,completion' FROM r1),
  'Order metric, stats, value, completion; stats makes one call of 50; value stays off');

-- 2. A short queue ends the loop.
SELECT pg_temp.reset_fixture(30, 7);
CREATE TEMP TABLE r2 AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 30 FROM r2 WHERE queue = 'completion')
  AND (SELECT processed = 7 FROM r2 WHERE queue = 'metric')
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_completion_recompute_queue)
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_metric_recompute_queue),
  'Short queues drain to empty and stop');

-- 3. A single failed row does not stop the queue; it is retried behind the backlog with its attempt counted.
SELECT pg_temp.reset_fixture(200, 0);
UPDATE public.fixture_behavior SET fail = true WHERE vehicle_id = pg_temp.vid(60);
CREATE TEMP TABLE r3 AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 199 AND errored = 2 FROM r3 WHERE queue = 'completion')
  AND (SELECT attempts = 2 AND last_error = 'synthetic completion failure' FROM public.vehicle_completion_recompute_queue
       WHERE vehicle_id = pg_temp.vid(60))
  AND (SELECT count(*) = 1 FROM public.vehicle_completion_recompute_queue),
  'One failed row: the other 199 drain, the failure is retried at the tail and counted twice');

-- 3b. A poison row reaches the purge: attempts 1, 2, then deleted on the third failure.
SELECT pg_temp.reset_fixture(1, 0);
UPDATE public.fixture_behavior SET fail = true WHERE vehicle_id = pg_temp.vid(1);
SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT attempts = 1 FROM public.vehicle_completion_recompute_queue WHERE vehicle_id = pg_temp.vid(1)),
  'Poison row: first run counts attempt 1');
SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT attempts = 2 FROM public.vehicle_completion_recompute_queue WHERE vehicle_id = pg_temp.vid(1)),
  'Poison row: second run counts attempt 2');
SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM public.vehicle_completion_recompute_queue WHERE vehicle_id = pg_temp.vid(1)),
  'Poison row: third failure is purged by attempts >= 3');

-- 3c. More than 20% failed rows stops the queue for the run.
SELECT pg_temp.reset_fixture(100, 0);
UPDATE public.fixture_behavior SET fail = true WHERE vehicle_id IN (SELECT pg_temp.vid(i) FROM generate_series(1, 6) i);
CREATE TEMP TABLE r3c AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 19 AND errored = 6 FROM r3c WHERE queue = 'completion')
  AND (SELECT count(*) = 81 FROM public.vehicle_completion_recompute_queue)
  AND (SELECT count(*) = 6 FROM public.vehicle_completion_recompute_queue WHERE attempts = 1),
  'Failure ratio 6/25 > 20%: completion stops after chunk 1');

-- 3d. Three chunks with failures stop the queue for the run even below 20%.
SELECT pg_temp.reset_fixture(300, 0);
UPDATE public.fixture_behavior SET fail = true WHERE vehicle_id IN (pg_temp.vid(10), pg_temp.vid(35), pg_temp.vid(60), pg_temp.vid(85));
CREATE TEMP TABLE r3d AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 72 AND errored = 3 FROM r3d WHERE queue = 'completion')
  AND (SELECT count(*) = 228 FROM public.vehicle_completion_recompute_queue)
  AND (SELECT attempts = 0 FROM public.vehicle_completion_recompute_queue WHERE vehicle_id = pg_temp.vid(85)),
  'Three failed chunks (3/75 rows): completion stops after chunk 3');

-- 4. A failed metric row is retried behind the backlog and never dropped.
SELECT pg_temp.reset_fixture(0, 100);
UPDATE public.fixture_behavior SET fail = true WHERE vehicle_id = pg_temp.vid(10);
CREATE TEMP TABLE r4 AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 99 AND errored = 2 FROM r4 WHERE queue = 'metric')
  AND (SELECT attempts = 2 FROM public.vehicle_metric_recompute_queue WHERE vehicle_id = pg_temp.vid(10))
  AND (SELECT count(*) = 1 FROM public.vehicle_metric_recompute_queue),
  'Metric failure: the other 99 fold, the failed fold stays queued with its attempts counted');

-- 5. A whole-call failure keeps the earlier chunks of the same queue; a failing queue does not roll back others.
SELECT pg_temp.reset_fixture(200, 0);
UPDATE public.fixture_behavior SET fail_claim = true WHERE vehicle_id = pg_temp.vid(70);
CREATE TEMP TABLE r5 AS SELECT * FROM public.drain_vehicle_derived_queues();
SELECT pg_temp.assert_true((SELECT processed = 50 AND errored = -1 FROM r5 WHERE queue = 'completion')
  AND (SELECT count(*) = 150 FROM public.vehicle_completion_recompute_queue)
  AND (SELECT min(queued_at) = '2026-01-01T00:00:00Z'::timestamptz + interval '51 seconds' FROM public.vehicle_completion_recompute_queue)
  AND (SELECT count(*) = 1 FROM public.fixture_calls WHERE fn = 'stats'),
  'Whole-call failure in chunk 3 keeps chunks 1-2, restores chunk 3 and reports -1');
SELECT pg_temp.reset_fixture(60, 5);
SET fixture.stats_fail = '1';
CREATE TEMP TABLE r5b AS SELECT * FROM public.drain_vehicle_derived_queues();
RESET fixture.stats_fail;
SELECT pg_temp.assert_true((SELECT errored = -1 FROM r5b WHERE queue = 'stats')
  AND (SELECT processed = 5 FROM r5b WHERE queue = 'metric')
  AND (SELECT processed = 60 FROM r5b WHERE queue = 'completion')
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_completion_recompute_queue),
  'A failing stats drain neither rolls back metric nor blocks completion');

-- 6. Time slices. Windows are wide on purpose: shared CI runners can run 3x slower than a laptop.
-- 6a. Completion stops starting chunks at half the budget (budget 6 s: 3 s). 25 rows x 20 ms = 0.5 s per chunk.
SELECT pg_temp.reset_fixture(1000, 0);
UPDATE public.fixture_behavior SET sleep_ms = 20;
CREATE TEMP TABLE t6 AS SELECT clock_timestamp() t0;
CREATE TEMP TABLE r6 AS SELECT * FROM public.drain_vehicle_derived_queues(false, 6);
SELECT pg_temp.assert_true((SELECT processed BETWEEN 50 AND 150 FROM r6 WHERE queue = 'completion')
  AND (SELECT clock_timestamp() - t0 < interval '6 seconds' FROM t6),
  'Budget 6 s: completion starts no chunk after 3 s and the run ends inside the budget');
-- 6b. A metric burst takes at most its third (budget 12 s: 4 s) and completion still gets its slice.
SELECT pg_temp.reset_fixture(500, 200);
UPDATE public.fixture_behavior SET sleep_ms = 30;  -- metric 10 x 30 ms = 0.3 s per chunk; completion 0.75 s
CREATE TEMP TABLE t6b AS SELECT clock_timestamp() t0;
CREATE TEMP TABLE r6b AS SELECT * FROM public.drain_vehicle_derived_queues(false, 12);
SELECT pg_temp.assert_true((SELECT processed BETWEEN 10 AND 140 FROM r6b WHERE queue = 'metric')
  AND (SELECT count(*) >= 60 FROM public.vehicle_metric_recompute_queue)
  AND (SELECT NOT skipped AND processed >= 25 FROM r6b WHERE queue = 'completion')
  AND (SELECT clock_timestamp() - t0 < interval '12 seconds' FROM t6b),
  'Metric burst stops at a third of the budget; completion still drains in its slice');
-- 6c. A zero budget is clamped to 5 s (not "skip everything"); NULL is treated as 45 s (not "never stop").
SELECT pg_temp.reset_fixture(1000, 0);
UPDATE public.fixture_behavior SET sleep_ms = 20;
CREATE TEMP TABLE t6c AS SELECT clock_timestamp() t0;
CREATE TEMP TABLE r6c AS SELECT * FROM public.drain_vehicle_derived_queues(false, 0);
SELECT pg_temp.assert_true((SELECT NOT skipped AND processed BETWEEN 25 AND 125 FROM r6c WHERE queue = 'completion')
  AND (SELECT clock_timestamp() - t0 < interval '5 seconds' FROM t6c),
  'Budget 0 is clamped to 5 s: completion runs and stops starting chunks at 2.5 s');
SELECT pg_temp.reset_fixture(1000, 0);
UPDATE public.fixture_behavior SET sleep_ms = 40;  -- 1 s per completion chunk; the 1,000 cap would take 40 s
CREATE TEMP TABLE t6d AS SELECT clock_timestamp() t0;
CREATE TEMP TABLE r6d AS SELECT * FROM public.drain_vehicle_derived_queues(false, NULL);
SELECT pg_temp.assert_true((SELECT processed BETWEEN 100 AND 575 FROM r6d WHERE queue = 'completion')
  AND (SELECT clock_timestamp() - t0 < interval '45 seconds' FROM t6d),
  'NULL budget is treated as 45 s: completion stops starting chunks at 22.5 s instead of running to the cap');

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

-- 8. A vehicles row held by another backend fails that one vehicle after the 2 s lock_timeout; the run completes.
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
  AND (SELECT clock_timestamp() - t0 BETWEEN interval '1.9 seconds' AND interval '12 seconds' FROM t8),
  'Locked vehicle fails after the 2 s lock_timeout and is re-queued; the other 19 are written');
SELECT pg_temp.assert_true(current_setting('lock_timeout') = '0',
  'lock_timeout is transaction-local and resets after the run');
SELECT dblink_exec('lock_holder', 'ROLLBACK');
SELECT dblink_disconnect('lock_holder');

-- 9. Faster intake and the same installed controller. A second backend starts
-- its transaction before these synthetic sources commit. READ COMMITTED sees
-- them, but the old fold's now() still records BEGIN and falsely predates input.
SELECT pg_temp.reset_fixture(0,0);
ALTER TABLE public.vehicle_observations ADD COLUMN ingested_at timestamptz;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text,schedule text,active boolean,command text);
CREATE FUNCTION cron.alter_job(job_id bigint,schedule text) RETURNS void LANGUAGE sql AS
$$ UPDATE cron.job SET schedule=$2 WHERE jobid=$1 $$;
INSERT INTO cron.job VALUES (500,'drain-vehicle-derived-queues','*/5 * * * *',true,
 'SET statement_timeout = ''55s''; SELECT public.drain_vehicle_derived_queues(p_include_value := false);');
CREATE TEMP TABLE clock_contract AS
 SELECT p.oid,p.proacl,p.proowner,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) AS body
 FROM pg_proc p WHERE p.oid IN ('public.drain_vehicle_metric_queue(integer)'::regprocedure,
 'public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure);
SELECT pg_temp.assert_true(
 encode(sha256(convert_to(pg_get_functiondef('public.drain_vehicle_metric_queue(integer)'::regprocedure),'UTF8')),'base64')
 = 'oQzzspRSSBOuW0GTD2pyzSC5488n+lNEWe7RX/YkHoM=', 'Metric fixture is the measured current owner');
SELECT dblink_connect('clock_reader',format('host=%s port=%s dbname=%s user=%s',
 split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_database(),current_user));
SELECT dblink_exec('clock_reader','BEGIN');
CREATE TEMP TABLE old_begin AS SELECT * FROM dblink('clock_reader','SELECT now()') AS t(tx_start timestamptz);
INSERT INTO public.vehicle_observations(vehicle_id,kind,observed_at,ingested_at)
 VALUES(pg_temp.vid(1),'listing','2020-01-01',clock_timestamp());
INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,live_metrics_dirty,observation_count_dirty)
 VALUES(pg_temp.vid(1),true,true);
SELECT * FROM dblink('clock_reader','SELECT * FROM public.drain_vehicle_metric_queue(1)') AS t(processed int,errored int);
SELECT dblink_exec('clock_reader','COMMIT');
SELECT pg_temp.assert_true((SELECT m.observation_count=1 AND v.observation_count=1 AND m.comment_count=0
 AND m.last_observation_at=o.observed_at AND m.updated_at=b.tx_start AND m.updated_at<o.ingested_at
 FROM public.vehicle_live_metrics m JOIN public.vehicles v ON v.id=m.vehicle_id
 JOIN public.vehicle_observations o ON o.vehicle_id=m.vehicle_id CROSS JOIN old_begin b),
 'Negative control: correct counts but transaction-start fold clock predates its included committed source');

-- Execute the production migration on actual paused/changed-owner controls.
UPDATE cron.job SET active=false;
\set ON_ERROR_STOP off
\ir ../migrations/20261008080147_repair_metric_fold_clock_and_cadence.sql
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true((SELECT NOT active AND schedule='*/5 * * * *' FROM cron.job)
 AND pg_get_functiondef('public.drain_vehicle_metric_queue(integer)'::regprocedure)=
 (SELECT body FROM clock_contract WHERE oid='public.drain_vehicle_metric_queue(integer)'::regprocedure),
 'Owner pause refuses the migration atomically');
UPDATE cron.job SET active=true,command='SELECT public.drain_vehicle_derived_queues(p_include_value := true);';
\set ON_ERROR_STOP off
\ir ../migrations/20261008080147_repair_metric_fold_clock_and_cadence.sql
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true((SELECT schedule='*/5 * * * *' AND command LIKE '%true%' FROM cron.job)
 AND pg_get_functiondef('public.drain_vehicle_metric_queue(integer)'::regprocedure)=
 (SELECT body FROM clock_contract WHERE oid='public.drain_vehicle_metric_queue(integer)'::regprocedure),
 'Changed value contract refuses without clock or cadence changes');
UPDATE cron.job SET command='SET statement_timeout = ''55s''; SELECT public.drain_vehicle_derived_queues(p_include_value := false);';
DO $$ BEGIN EXECUTE replace((SELECT body FROM clock_contract
 WHERE oid='public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure),
 'chunk = rows per inner call','chunk = altered owner'); END $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261008080147_repair_metric_fold_clock_and_cadence.sql
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true((SELECT schedule='*/5 * * * *' FROM cron.job)
 AND pg_get_functiondef('public.drain_vehicle_metric_queue(integer)'::regprocedure)=
 (SELECT body FROM clock_contract WHERE oid='public.drain_vehicle_metric_queue(integer)'::regprocedure),
 'Controller drift refuses atomically');
DO $$ BEGIN EXECUTE (SELECT body FROM clock_contract
 WHERE oid='public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure); END $$;
DO $$ BEGIN EXECUTE replace((SELECT body FROM clock_contract
 WHERE oid='public.drain_vehicle_metric_queue(integer)'::regprocedure),
 'metric fold failed','metric fold owner changed'); END $$;
CREATE TEMP TABLE clock_drift AS SELECT pg_get_functiondef('public.drain_vehicle_metric_queue(integer)'::regprocedure) body;
\set ON_ERROR_STOP off
\ir ../migrations/20261008080147_repair_metric_fold_clock_and_cadence.sql
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true((SELECT schedule='*/5 * * * *' FROM cron.job)
 AND pg_get_functiondef('public.drain_vehicle_metric_queue(integer)'::regprocedure)=(SELECT body FROM clock_drift),
 'Metric owner drift refuses and preserves that owner');
DO $$ BEGIN EXECUTE (SELECT body FROM clock_contract
 WHERE oid='public.drain_vehicle_metric_queue(integer)'::regprocedure); END $$;
\ir ../migrations/20261008080147_repair_metric_fold_clock_and_cadence.sql
\ir ../migrations/20261008080147_repair_metric_fold_clock_and_cadence.sql
SELECT pg_temp.assert_true((SELECT active AND schedule='*/2 * * * *'
 AND command='SET statement_timeout = ''55s''; SELECT public.drain_vehicle_derived_queues(p_include_value := false);' FROM cron.job)
 AND (SELECT count(*)=1 FROM cron.job)
 AND (SELECT bool_and(p.proacl IS NOT DISTINCT FROM c.proacl AND p.proowner=c.proowner
 AND p.prosecdef=c.prosecdef AND p.proconfig IS NOT DISTINCT FROM c.proconfig)
 FROM clock_contract c JOIN pg_proc p USING(oid))
 AND (SELECT body=pg_get_functiondef(oid) FROM clock_contract
 WHERE oid='public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure),
 'Replay preserves identity/ACL/config/controller/caps/budgets/value OFF and changes only the existing cadence');

-- Positive control repeats the real two-backend ordering after the repair.
SELECT dblink_exec('clock_reader','BEGIN');
CREATE TEMP TABLE new_begin AS SELECT * FROM dblink('clock_reader','SELECT now()') AS t(tx_start timestamptz);
INSERT INTO public.vehicle_observations(vehicle_id,kind,observed_at,ingested_at)
 VALUES(pg_temp.vid(1),'comment','2021-01-01',clock_timestamp());
CREATE TEMP TABLE source_clocks AS SELECT id,observed_at,ingested_at FROM public.vehicle_observations;
INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,live_metrics_dirty,observation_count_dirty)
 VALUES(pg_temp.vid(1),true,true);
SELECT * FROM dblink('clock_reader','SELECT * FROM public.drain_vehicle_metric_queue(1)') AS t(processed int,errored int);
SELECT dblink_exec('clock_reader','COMMIT');
SELECT pg_temp.assert_true((SELECT m.observation_count=2 AND v.observation_count=2 AND m.comment_count=1
 AND m.last_observation_at='2021-01-01'::timestamptz AND m.updated_at>=s.latest AND s.latest>b.tx_start
 FROM public.vehicle_live_metrics m JOIN public.vehicles v ON v.id=m.vehicle_id
 CROSS JOIN (SELECT max(ingested_at) latest FROM public.vehicle_observations) s CROSS JOIN new_begin b)
 AND NOT EXISTS(SELECT 1 FROM public.vehicle_metric_recompute_queue)
 AND (SELECT count(*)=2 AND bool_and(o.observed_at=c.observed_at AND o.ingested_at=c.ingested_at)
 FROM source_clocks c JOIN public.vehicle_observations o USING(id)),
 'After repair source committed after BEGIN has a current fold, exact counts/event maximum and unchanged original clocks');
SELECT dblink_disconnect('clock_reader');

-- The repaired owner still durably retries failed parent computation.
UPDATE public.fixture_behavior SET fail=true WHERE vehicle_id=pg_temp.vid(1);
INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,live_metrics_dirty,observation_count_dirty,attempts)
 VALUES(pg_temp.vid(1),true,true,2);
CREATE TEMP TABLE retry_result AS SELECT * FROM public.drain_vehicle_metric_queue(1);
SELECT pg_temp.assert_true((SELECT processed=0 AND errored=1 FROM retry_result)
 AND (SELECT attempts=3 AND live_metrics_dirty AND observation_count_dirty AND last_error LIKE '%synthetic metric%'
 FROM public.vehicle_metric_recompute_queue)
 AND (SELECT observation_count=2 FROM public.vehicle_live_metrics),
 'Repaired clock keeps per-parent error rollback and durable retry flags/attempts');
UPDATE public.fixture_behavior SET fail=false WHERE vehicle_id=pg_temp.vid(1);
CREATE TEMP TABLE recovered_result AS SELECT * FROM public.drain_vehicle_metric_queue(1);
SELECT pg_temp.assert_true((SELECT processed=1 AND errored=0 FROM recovered_result)
 AND NOT EXISTS(SELECT 1 FROM public.vehicle_metric_recompute_queue), 'A successful retry clears only materialized work');
