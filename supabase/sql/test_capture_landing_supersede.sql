-- Landing supersede (20261113120200): an older awaiting_gate chunk is retired only when a newer plan of the same day covers
-- all its clear photos; dry by default, cap 50 (halt above), signed per row, revert by run, nothing else changes.
-- Requires empty disposable dm_refinement_capture_landing_supersede* database.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_landing_supersede%' THEN RAISE EXCEPTION 'refusing: not a disposable contract database'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE TABLE public.capture_landing_chunks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), track text DEFAULT 'recent', pass int, user_id uuid,
  t_from timestamptz, t_to timestamptz, dry boolean DEFAULT false, state text CHECK (state IN ('planning','planned','awaiting_gate','applying','applied','gate_failed','empty','superseded')),
  run_id uuid DEFAULT gen_random_uuid(), plan_cursor timestamptz, stats jsonb DEFAULT '{}', note text, created_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_sets (chunk_id uuid, set_key text, image_ids uuid[], decision text);
CREATE TABLE public.filing_run_gate (run_id text PRIMARY KEY, passed boolean);
CREATE TABLE public.auto_filing_audit_queue (id bigserial, image_id uuid, run_id text, source text, status text);

\i supabase/migrations/20261113120200_capture_landing_supersede.sql
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_landing_supersede_v1(uuid, uuid, boolean, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_landing_supersede_revert_v1(uuid)', 'EXECUTE'), 'not callable by anon or authenticated');

-- fixtures (owner U): day A has 3 plans of the same set {1,2} (old1, old2 waiting; new waiting); day B: old waiting {3,4},
-- newer plan only has {3} (different photo set: keep); day C: single waiting plan (keep); day D: old waiting, newer passed? no:
-- old D's own gate passed (keep: it is about to apply); day E: other user's duplicate (keep).
CREATE FUNCTION pg_temp.u() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-0000000000aa'::uuid $$;
CREATE FUNCTION pg_temp.i(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.chunk(id text, usr uuid, d date, pass int, st text, age int, imgs int[]) RETURNS void LANGUAGE sql AS $$
  INSERT INTO capture_landing_chunks(id, user_id, t_from, t_to, pass, state, created_at)
  VALUES (id::uuid, usr, d::timestamptz, (d + 1)::timestamptz, pass, st, now() - make_interval(hours => age));
  INSERT INTO capture_landing_sets VALUES (id::uuid, 's-' || d, ARRAY(SELECT pg_temp.i(x) FROM unnest(imgs) x), 'clear') $$;
CREATE FUNCTION pg_temp.fixtures() RETURNS void LANGUAGE sql AS $$
  TRUNCATE capture_landing_chunks, capture_landing_sets, filing_run_gate, capture_landing_supersede_log;
  SELECT pg_temp.chunk('a0000000-0000-4000-8000-000000000001', pg_temp.u(), '2026-11-03', 1, 'awaiting_gate', 30, '{1,2}');
  SELECT pg_temp.chunk('a0000000-0000-4000-8000-000000000002', pg_temp.u(), '2026-11-03', 2, 'awaiting_gate', 20, '{1,2}');
  SELECT pg_temp.chunk('a0000000-0000-4000-8000-000000000003', pg_temp.u(), '2026-11-03', 3, 'awaiting_gate', 10, '{1,2}');
  SELECT pg_temp.chunk('b0000000-0000-4000-8000-000000000001', pg_temp.u(), '2017-11-06', 1, 'awaiting_gate', 30, '{3,4}');
  SELECT pg_temp.chunk('b0000000-0000-4000-8000-000000000002', pg_temp.u(), '2017-11-06', 2, 'awaiting_gate', 10, '{3}');
  SELECT pg_temp.chunk('c0000000-0000-4000-8000-000000000001', pg_temp.u(), '2017-11-07', 1, 'awaiting_gate', 30, '{5}');
  SELECT pg_temp.chunk('d0000000-0000-4000-8000-000000000001', pg_temp.u(), '2017-11-08', 1, 'awaiting_gate', 30, '{6}');
  SELECT pg_temp.chunk('d0000000-0000-4000-8000-000000000002', pg_temp.u(), '2017-11-08', 2, 'gate_failed', 10, '{6}');
  SELECT pg_temp.chunk('e0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000bb', '2026-11-03', 1, 'awaiting_gate', 30, '{7}');
  SELECT pg_temp.chunk('e0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000bb', '2026-11-03', 2, 'awaiting_gate', 10, '{7}');
  INSERT INTO filing_run_gate SELECT run_id::text, true FROM capture_landing_chunks WHERE id = 'd0000000-0000-4000-8000-000000000001';
$$;
CREATE FUNCTION pg_temp.states() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(left(id::text, 1) || right(id::text, 1) || '=' || state, ',' ORDER BY id) FROM capture_landing_chunks $$;

SELECT pg_temp.fixtures();
SELECT pg_temp.states() AS before \gset
SELECT public.capture_landing_supersede_v1(pg_temp.u(), 'f0000000-0000-4000-8000-000000000001') AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'dry_run' = 'true' AND ((:'r')::jsonb->>'would_supersede')::int = 2, 'dry run by default: the two older day-A plans');
SELECT pg_temp.assert_true(pg_temp.states() = :'before' AND (SELECT count(*) FROM capture_landing_supersede_log) = 0, 'a dry run writes nothing');

SELECT public.capture_landing_supersede_v1(pg_temp.u(), 'f0000000-0000-4000-8000-000000000002', false, 1) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'halted_over_cap')::boolean AND pg_temp.states() = :'before', 'above the cap the run halts and writes nothing');

SELECT public.capture_landing_supersede_v1(pg_temp.u(), 'f0000000-0000-4000-8000-000000000003', false) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'superseded')::int = 2, 'applied: two chunks superseded');
SELECT pg_temp.assert_true((SELECT string_agg(left(id::text,1) || right(id::text,1), ',' ORDER BY id) FROM capture_landing_chunks WHERE state = 'superseded') = 'a1,a2',
  'only the older plans of day A; the newest A plan, a different photo set (B), a single plan (C), a gate-passed chunk (D) and another user (E) are kept');
SELECT pg_temp.assert_true((SELECT bool_and(stats->'superseded'->>'by' = 'a0000000-0000-4000-8000-000000000003' AND stats->'superseded'->>'prior_state' = 'awaiting_gate')
  FROM capture_landing_chunks WHERE state = 'superseded'), 'each superseded chunk records the newer plan and its prior state');
SELECT pg_temp.assert_true((SELECT count(*) = 2 AND bool_and(length(signature) = 64) FROM capture_landing_supersede_log WHERE run_id = 'f0000000-0000-4000-8000-000000000003'),
  'each row is logged under the run with a sha256 signature');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_landing_sets) = 10, 'sets are untouched');

-- idempotent: a second run finds nothing
SELECT public.capture_landing_supersede_v1(pg_temp.u(), 'f0000000-0000-4000-8000-000000000004', false) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'superseded')::int = 0, 'a second run supersedes nothing');

-- revert by run restores exactly the prior state and only what the run still owns
UPDATE capture_landing_chunks SET state = 'applied' WHERE id = 'a0000000-0000-4000-8000-000000000002';
SELECT public.capture_landing_supersede_revert_v1('f0000000-0000-4000-8000-000000000003') AS n \gset
SELECT pg_temp.assert_true(:n = 1 AND (SELECT state FROM capture_landing_chunks WHERE id = 'a0000000-0000-4000-8000-000000000001') = 'awaiting_gate'
  AND (SELECT state FROM capture_landing_chunks WHERE id = 'a0000000-0000-4000-8000-000000000002') = 'applied'
  AND (SELECT stats ? 'superseded' FROM capture_landing_chunks WHERE id = 'a0000000-0000-4000-8000-000000000001') = false, 'revert restores only rows the run still owns');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_landing_supersede_log WHERE run_id = 'f0000000-0000-4000-8000-000000000003' AND reverted_at IS NULL) = 0, 'log rows are marked reverted');

SELECT pg_temp.fixtures();
SELECT public.capture_landing_supersede_v1(pg_temp.u(), 'f0000000-0000-4000-8000-000000000005', false);
\i supabase/sql/revert_20261113120200_capture_landing_supersede.sql
SELECT pg_temp.assert_true(pg_temp.states() = :'before' AND to_regprocedure('public.capture_landing_supersede_v1(uuid, uuid, boolean, integer)') IS NULL,
  'the migration revert restores every chunk and drops the functions');
SELECT 'capture landing supersede contract: ok' AS result;
