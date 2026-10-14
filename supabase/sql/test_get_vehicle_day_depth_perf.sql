-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_day_depth -f this-file.sql
-- Proves the get_vehicle_day_depth rewrite (migration 20261014051000) answers exactly what the live function answers.
-- The migration swaps a join to a per-observation aggregate (re-run once per image by the planner) for two EXISTS probes
-- per image and pulls the byok_deep_analysis key out of ai_scan_metadata once. Nothing about the answer may change:
-- the same rows, the same counts, the same depth, the same return shape, still SECURITY DEFINER with search_path public,
-- still executable by anon. External, duplicate and superseded frames, inactive observations and observations of
-- another vehicle never count. A re-run is a no-op, and a drifted function is left as found.
-- The rows below are a disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET TimeZone = 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon;

-- The shapes the reader touches (pgvector is not in the CI image: the embedding column is text, only IS NOT NULL is read).
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, is_external boolean NOT NULL DEFAULT false,
  is_duplicate boolean, is_superseded boolean, taken_at timestamptz, created_at timestamptz DEFAULT now(),
  stale boolean, vision_gate_status public.vision_gate_status, ai_scan_metadata jsonb);
CREATE INDEX vehicle_images_vehicle_id_idx ON public.vehicle_images (vehicle_id);
CREATE TABLE public.image_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, vehicle_id uuid, is_active boolean, embedding_clip_vitb32 text);
CREATE INDEX idx_image_obs_image ON public.image_observations (image_id);
CREATE TABLE public.work_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, session_date date, owner_confirmed_at timestamptz);

-- The functions as production has them on 2026-10-14.
\ir helpers/get_vehicle_day_depth_live_20261014.sql
GRANT EXECUTE ON FUNCTION public.get_vehicle_day_depth(uuid) TO anon;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
SELECT public.t_assert(md5(pg_get_functiondef('public.get_vehicle_day_depth(uuid)'::regprocedure)) = 'e8347b640d968eeee98af6511f8ca657'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.nuke_image_depth_score(boolean,boolean,jsonb,boolean,boolean,boolean,boolean,boolean)'::regprocedure)) = '2bd969542e4b21c3061ab34f71c61b2c',  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  'the fixture is the live source');

-- Vehicle A (the one under test), B (another vehicle whose rows must not leak in) and C (no images at all).
\set va '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set vb '''bbbbbbbb-0000-0000-0000-00000000000b'''
\set vc '''cccccccc-0000-0000-0000-00000000000c'''

-- ALLOW_RAW_TESTIMONY_WRITE (disposable test database)
INSERT INTO public.vehicle_images (id, vehicle_id, is_external, is_duplicate, is_superseded, taken_at, created_at, stale, vision_gate_status, ai_scan_metadata) VALUES
 -- 2026-03-01: i1 deep and complete, placed with a clip, on a confirmed day; i2 plain; i3 external, i4 duplicate, i5 superseded (all three excluded)
 ('10000000-0000-0000-0000-000000000001', :va, false, false, false, '2026-03-01 10:00+00', now(), false, 'approved',
   '{"byok_deep_analysis": {"context_complete": true, "intent_confidence": 0.9, "components_seen": ["door"]}}'),
 ('10000000-0000-0000-0000-000000000002', :va, false, NULL, NULL, '2026-03-01 11:00+00', now(), NULL, 'approved', NULL),
 ('10000000-0000-0000-0000-000000000003', :va, true,  false, false, '2026-03-01 12:00+00', now(), false, 'approved', NULL),
 ('10000000-0000-0000-0000-000000000004', :va, false, true,  false, '2026-03-01 13:00+00', now(), false, 'approved', NULL),
 ('10000000-0000-0000-0000-000000000005', :va, false, false, true,  '2026-03-01 14:00+00', now(), false, 'approved', NULL),
 -- 2026-03-02: i6 deep but thin, stale, placed without a clip; i7 dated by created_at, observed only inactively and on another vehicle
 ('10000000-0000-0000-0000-000000000006', :va, false, false, false, '2026-03-02 09:00+00', now(), true, 'pending',
   '{"byok_deep_analysis": {"context_complete": false, "intent_confidence": 0.5, "components_seen": []}}'),
 ('10000000-0000-0000-0000-000000000007', :va, false, false, false, NULL, '2026-03-02 15:00+00', false, NULL, NULL),
 -- 2026-03-04: i8 key present with a JSON null, i9 other keys only, i10 observed with is_active NULL
 ('10000000-0000-0000-0000-000000000008', :va, false, false, false, '2026-03-04 08:00+00', now(), false, 'approved', '{"byok_deep_analysis": null}'),
 ('10000000-0000-0000-0000-000000000009', :va, false, false, false, '2026-03-04 09:00+00', now(), false, NULL, '{"other": 1}'),
 ('10000000-0000-0000-0000-000000000010', :va, false, false, false, '2026-03-04 10:00+00', now(), false, 'approved', NULL),
 -- no date at all: excluded
 ('10000000-0000-0000-0000-000000000011', :va, false, false, false, NULL, NULL, false, 'approved', NULL),
 -- vehicle B
 ('20000000-0000-0000-0000-000000000001', :vb, false, false, false, '2026-03-01 10:00+00', now(), false, 'approved',
   '{"byok_deep_analysis": {"context_complete": true, "intent_confidence": 0.9, "components_seen": ["hood"]}}');
INSERT INTO public.image_observations (image_id, vehicle_id, is_active, embedding_clip_vitb32) VALUES
 ('10000000-0000-0000-0000-000000000001', :va, true,  'e'),
 ('10000000-0000-0000-0000-000000000001', :va, true,  NULL),     -- a second row for the same image changes nothing
 ('10000000-0000-0000-0000-000000000006', :va, true,  NULL),     -- placed, no clip
 ('10000000-0000-0000-0000-000000000007', :va, false, 'e'),      -- inactive: not placed
 ('10000000-0000-0000-0000-000000000007', :vb, true,  'e'),      -- another vehicle's observation of this image: not placed for A
 ('10000000-0000-0000-0000-000000000010', :va, NULL,  NULL),     -- is_active NULL counts as active
 ('20000000-0000-0000-0000-000000000001', :vb, true,  'e');
INSERT INTO public.work_sessions (vehicle_id, session_date, owner_confirmed_at) VALUES
 (:va, '2026-03-01', '2026-03-05 00:00+00'),   -- owner-confirmed day
 (:va, '2026-03-02', NULL),                    -- not confirmed
 (:vb, '2026-03-02', '2026-03-05 00:00+00');   -- another vehicle's confirmation

-- 1. Before: what the live function answers.
CREATE TABLE public.t_before AS
  SELECT :va::uuid AS vid, f.* FROM public.get_vehicle_day_depth(:va) f
  UNION ALL SELECT :vb::uuid, f.* FROM public.get_vehicle_day_depth(:vb) f
  UNION ALL SELECT :vc::uuid, f.* FROM public.get_vehicle_day_depth(:vc) f;
SELECT public.t_assert((SELECT count(*) FROM public.t_before) = 4, 'before: 3 days for A, 1 for B, none for C');
CREATE TABLE public.t_props_before AS
  SELECT p.prosecdef, p.provolatile, p.proconfig::text AS cfg, pg_get_function_result(p.oid) AS result,
         has_function_privilege('anon', p.oid, 'execute') AS anon_exec
  FROM pg_proc p WHERE p.oid = 'public.get_vehicle_day_depth(uuid)'::regprocedure;

-- 2. The migration.
\ir ../migrations/20261014051000_get_vehicle_day_depth_index_probes.sql

-- 3. After: the same rows, to the digit.
CREATE TABLE public.t_after AS
  SELECT :va::uuid AS vid, f.* FROM public.get_vehicle_day_depth(:va) f
  UNION ALL SELECT :vb::uuid, f.* FROM public.get_vehicle_day_depth(:vb) f
  UNION ALL SELECT :vc::uuid, f.* FROM public.get_vehicle_day_depth(:vc) f;
SELECT public.t_assert(NOT EXISTS (SELECT * FROM public.t_before EXCEPT SELECT * FROM public.t_after)
  AND NOT EXISTS (SELECT * FROM public.t_after EXCEPT SELECT * FROM public.t_before)
  AND (SELECT count(*) FROM public.t_before) = (SELECT count(*) FROM public.t_after), 'after: identical rows');

-- ...and the rows are the ones worked out by hand from the score formula (so old == new is not two wrongs):
--   03-01: i1 .12+.30+.08+.08+.07+.13+.07+.07 = .92, i2 .12+.07 = .19   -> avg .5550, 2 photos, 1 seen, 1 placed
--   03-02: i6 .30+.13-.05 = .38, i7 0                                    -> avg .1900, 2 photos, 1 seen, 1 placed
--   03-04: i8 .12+.30 = .42, i9 0, i10 .12+.13 = .25                     -> avg .2233, 3 photos, 1 seen, 1 placed
SELECT public.t_assert((SELECT array_agg(ARRAY[day::text, photos::text, seen::text, placed::text, depth::text] ORDER BY day)
    FROM public.get_vehicle_day_depth(:va))
  = ARRAY[ARRAY['2026-03-01', '2', '1', '1', '0.5550'], ARRAY['2026-03-02', '2', '1', '1', '0.1900'], ARRAY['2026-03-04', '3', '1', '1', '0.2233']],
  'after: the hand-computed days');
SELECT public.t_assert((SELECT count(*) FROM public.get_vehicle_day_depth(:vc)) = 0, 'after: a vehicle with no images has no days');
SELECT public.t_assert((SELECT depth FROM public.get_vehicle_day_depth(:vb)) = 0.8500 AND (SELECT photos FROM public.get_vehicle_day_depth(:vb)) = 1,
  'after: B answers from its own rows only (.12+.30+.08+.08+.07+.13+.07 = .85; A''s confirmed day 03-01 does not reach B)');

-- 4. Shape and rights are as they were.
SELECT public.t_assert((SELECT (prosecdef, provolatile, cfg, result, anon_exec) FROM public.t_props_before)
  = (SELECT (p.prosecdef, p.provolatile, p.proconfig::text, pg_get_function_result(p.oid), has_function_privilege('anon', p.oid, 'execute'))
       FROM pg_proc p WHERE p.oid = 'public.get_vehicle_day_depth(uuid)'::regprocedure), 'after: security definer, volatility, search_path, result type and anon EXECUTE unchanged');
SELECT public.t_assert((SELECT prosecdef AND provolatile = 's' AND proconfig::text LIKE '%search_path=public%' FROM pg_proc
  WHERE oid = 'public.get_vehicle_day_depth(uuid)'::regprocedure), 'after: still a stable security definer with search_path public');
SET ROLE anon;
SELECT public.t_assert((SELECT count(*) FROM public.get_vehicle_day_depth(:va)) = 3, 'anon still reads it');
RESET ROLE;

-- 5. A second run is a no-op that passes the guard.
\ir ../migrations/20261014051000_get_vehicle_day_depth_index_probes.sql
SELECT public.t_assert(NOT EXISTS (SELECT * FROM public.t_after EXCEPT
  (SELECT :va::uuid, f.* FROM public.get_vehicle_day_depth(:va) f UNION ALL SELECT :vb::uuid, f.* FROM public.get_vehicle_day_depth(:vb) f)),
  'a re-run leaves the answers alone');

-- 6. A drifted source stops the migration and is left as found.
CREATE OR REPLACE FUNCTION public.get_vehicle_day_depth(p_vehicle_id uuid)
 RETURNS TABLE(day date, photos integer, seen integer, placed integer, depth numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
 AS $f$ SELECT NULL::date, NULL::int, NULL::int, NULL::int, NULL::numeric WHERE false $f$;
\echo 'Expected: the source guard ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014051000_get_vehicle_day_depth_index_probes.sql
\set ON_ERROR_STOP on
SELECT public.t_assert((SELECT prosrc FROM pg_proc WHERE oid = 'public.get_vehicle_day_depth(uuid)'::regprocedure) LIKE '%WHERE false%',
  'a drifted function is not replaced');
SELECT 'get_vehicle_day_depth perf contract: PASS' AS result;
