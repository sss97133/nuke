-- Contract: 20261115140000 typ-aware supersede coverage, plus the original 20261113120200 rules.
-- An older awaiting_gate chunk is retired when a newer plan covers every old clear photo
-- or the omitted photos are typ=other/receipt / blocked. Disposable DB only.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_landing_supersede_typ%' THEN
    RAISE EXCEPTION 'refusing: not a disposable contract database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE TABLE public.capture_landing_chunks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), track text DEFAULT 'recent', pass int, user_id uuid,
  t_from timestamptz, t_to timestamptz, dry boolean DEFAULT false, state text CHECK (state IN ('planning','planned','awaiting_gate','applying','applied','gate_failed','empty','superseded')),
  run_id uuid DEFAULT gen_random_uuid(), plan_cursor timestamptz, stats jsonb DEFAULT '{}', note text, created_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_sets (chunk_id uuid, set_key text, image_ids uuid[], decision text);
CREATE TABLE public.filing_run_gate (run_id text PRIMARY KEY, passed boolean);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY,
  ai_scan_metadata jsonb,
  is_duplicate boolean DEFAULT false,
  is_superseded boolean DEFAULT false,
  is_sensitive boolean DEFAULT false,
  vision_gate_status text
);

\i supabase/migrations/20261115140000_capture_landing_supersede_typ_coverage.sql
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_landing_supersede_v1(uuid, uuid, boolean, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_landing_supersede_revert_v1(uuid)', 'EXECUTE'), 'not callable by anon or authenticated');
SELECT pg_temp.assert_true(position('(20261115140000)' IN pg_get_functiondef('public.capture_landing_supersede_v1(uuid, uuid, boolean, integer)'::regprocedure)) > 0,
  'typ-coverage marker landed');

CREATE FUNCTION pg_temp.u() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-0000000000aa'::uuid $$;
CREATE FUNCTION pg_temp.i(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.chunk(id text, usr uuid, d date, pass int, st text, age int, imgs int[]) RETURNS void LANGUAGE sql AS $$
  INSERT INTO capture_landing_chunks(id, user_id, t_from, t_to, pass, state, created_at)
  VALUES (id::uuid, usr, d::timestamptz, (d + 1)::timestamptz, pass, st, now() - make_interval(hours => age));
  INSERT INTO capture_landing_sets VALUES (id::uuid, 's-' || d, ARRAY(SELECT pg_temp.i(x) FROM unnest(imgs) x), 'clear') $$;
CREATE FUNCTION pg_temp.fixtures() RETURNS void LANGUAGE sql AS $$
  TRUNCATE capture_landing_chunks, capture_landing_sets, filing_run_gate, capture_landing_supersede_log, vehicle_images;
  -- original 13120200 fixtures
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
  -- typ-coverage fixtures
  -- F: old typ=other clear, newer plan has no typ frame (0-set / other photos) -> supersede
  SELECT pg_temp.chunk('f0000000-0000-4000-8000-000000000001', pg_temp.u(), '2026-02-18', 1, 'awaiting_gate', 30, '{10}');
  SELECT pg_temp.chunk('f0000000-0000-4000-8000-000000000002', pg_temp.u(), '2026-02-18', 2, 'applied', 10, '{11}');
  INSERT INTO vehicle_images (id, ai_scan_metadata) VALUES (pg_temp.i(10), '{"classification":{"image_type":"other"}}');
  INSERT INTO vehicle_images (id, ai_scan_metadata) VALUES (pg_temp.i(11), '{"classification":{"image_type":"vehicle_exterior"}}');
  -- G: old vehicle clear, newer plan omits it and it is not typ/blocked -> keep
  SELECT pg_temp.chunk('60000000-0000-4000-8000-000000000001', pg_temp.u(), '2026-02-20', 1, 'awaiting_gate', 30, '{12}');
  SELECT pg_temp.chunk('60000000-0000-4000-8000-000000000002', pg_temp.u(), '2026-02-20', 2, 'applied', 10, '{13}');
  INSERT INTO vehicle_images (id, ai_scan_metadata) VALUES (pg_temp.i(12), '{"classification":{"image_type":"vehicle_exterior"}}');
  INSERT INTO vehicle_images (id, ai_scan_metadata) VALUES (pg_temp.i(13), '{"classification":{"image_type":"vehicle_exterior"}}');
  -- H: old typ+vehicle, newer has only the vehicle -> supersede (typ accounted)
  SELECT pg_temp.chunk('70000000-0000-4000-8000-000000000001', pg_temp.u(), '2026-02-27', 1, 'awaiting_gate', 30, '{14,15}');
  SELECT pg_temp.chunk('70000000-0000-4000-8000-000000000002', pg_temp.u(), '2026-02-27', 2, 'gate_failed', 10, '{15}');
  INSERT INTO vehicle_images (id, ai_scan_metadata) VALUES (pg_temp.i(14), '{"classification":{"image_type":"receipt_document"}}');
  INSERT INTO vehicle_images (id, ai_scan_metadata) VALUES (pg_temp.i(15), '{"classification":{"image_type":"vehicle_exterior"}}');
$$;
CREATE FUNCTION pg_temp.states() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(left(id::text, 1) || right(id::text, 1) || '=' || state, ',' ORDER BY id) FROM capture_landing_chunks $$;

SELECT pg_temp.fixtures();
SELECT pg_temp.states() AS before \gset
SELECT public.capture_landing_supersede_v1(pg_temp.u(), 'f0000000-0000-4000-8000-0000000000d1') AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'dry_run' = 'true' AND ((:'r')::jsonb->>'would_supersede')::int = 4, 'dry run: two older day-A plans plus typ days F and H');
SELECT pg_temp.assert_true(pg_temp.states() = :'before' AND (SELECT count(*) FROM capture_landing_supersede_log) = 0, 'a dry run writes nothing');

SELECT public.capture_landing_supersede_v1(pg_temp.u(), 'f0000000-0000-4000-8000-0000000000d2', false, 1) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'halted_over_cap')::boolean AND pg_temp.states() = :'before', 'above the cap the run halts and writes nothing');

SELECT public.capture_landing_supersede_v1(pg_temp.u(), 'f0000000-0000-4000-8000-0000000000d3', false) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'superseded')::int = 4, 'applied: A1,A2,F1,H1 superseded');
SELECT pg_temp.assert_true((SELECT string_agg(left(id::text,1) || right(id::text,1), ',' ORDER BY id)
  FROM capture_landing_chunks WHERE state = 'superseded') = '71,a1,a2,f1',
  'typ-omitted F and typ+vehicle H supersede; a different photo set (B), a single plan (C), a gate-passed chunk (D), another user (E), and a still-uncovered vehicle (G) are kept');

\i supabase/sql/revert_20261115140000_capture_landing_supersede_typ_coverage.sql
SELECT pg_temp.assert_true(position('(20261115140000)' IN pg_get_functiondef('public.capture_landing_supersede_v1(uuid, uuid, boolean, integer)'::regprocedure)) = 0,
  'revert removes the typ-coverage marker');
SELECT pg_temp.fixtures();
SELECT public.capture_landing_supersede_v1(pg_temp.u(), 'f0000000-0000-4000-8000-0000000000d4') AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'dry_run' = 'true' AND ((:'r')::jsonb->>'would_supersede')::int = 2,
  'after revert, typ-omitted days are no longer covered and only the two older day-A plans would supersede');
SELECT 'capture landing supersede typ coverage contract: ok' AS result;
