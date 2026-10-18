-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_burst_total -f this-file.sql
-- Proves the compute_active_minutes_burst_total rewrite (migration 20261014051500) answers exactly what the live
-- function answers. The live function called compute_active_minutes_burst once per photo day, and every call read the
-- vehicle's whole image set again (days x images). The migration does it in one window-function pass. The per-day rule
-- must not move: bursts split where two photos are MORE than the gap apart (exactly the gap stays one burst), credit per
-- burst is max(span in minutes, 5 x photos) + 10, a day is rounded and capped at 480, ties and undated photos behave as
-- before, other vehicles never leak in, and the function stays SECURITY INVOKER so the caller's row policies still decide
-- which photos count. The default gap of 30 stays. A re-run is a no-op, and a drifted function is left as found.
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

-- The one table the functions read, with a row policy so the INVOKER semantics can be told apart from a definer's.
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, taken_at timestamptz, hidden boolean NOT NULL DEFAULT false);
CREATE INDEX vehicle_images_vehicle_id_idx ON public.vehicle_images (vehicle_id);
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_sees_unhidden ON public.vehicle_images FOR SELECT TO anon USING (NOT hidden);
GRANT SELECT ON public.vehicle_images TO anon;

-- The functions as production has them on 2026-10-14.
\ir helpers/compute_active_minutes_burst_live_20261014.sql
GRANT EXECUTE ON FUNCTION public.compute_active_minutes_burst_total(uuid, integer), public.compute_active_minutes_burst(uuid, date, integer) TO anon;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon;
SELECT public.t_assert(md5(pg_get_functiondef('public.compute_active_minutes_burst_total(uuid,integer)'::regprocedure)) = '7c2d2f3d8bf6196b9a5c6b46de945f23'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.compute_active_minutes_burst(uuid,date,integer)'::regprocedure)) = '5cc599c768be5898b0528a7acd99ff49',  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  'the fixture is the live source');

\set v1 '''11111111-0000-0000-0000-000000000001'''
\set v2 '''22222222-0000-0000-0000-000000000002'''
\set v3 '''33333333-0000-0000-0000-000000000003'''
\set v4 '''44444444-0000-0000-0000-000000000004'''

-- ALLOW_RAW_TESTIMONY_WRITE (disposable test database)
INSERT INTO public.vehicle_images (vehicle_id, taken_at) VALUES
 -- 04-01: one tight burst of four photos over 6 minutes: max(6, 20) + 10 = 30
 (:v1, '2026-04-01 09:00+00'), (:v1, '2026-04-01 09:02+00'), (:v1, '2026-04-01 09:04+00'), (:v1, '2026-04-01 09:06+00'),
 -- 04-02: [10:00, 10:10] = max(10, 10) + 10 = 20, then three lone photos 50, 45 and 45 minutes apart = 15 each: 65
 (:v1, '2026-04-02 10:00+00'), (:v1, '2026-04-02 10:10+00'), (:v1, '2026-04-02 11:00+00'), (:v1, '2026-04-02 11:45+00'), (:v1, '2026-04-02 12:30+00'),
 -- 04-03: one photo: 15
 (:v1, '2026-04-03 08:00+00'),
 -- 04-04: exactly 30 minutes apart stays one burst: max(30, 10) + 10 = 40
 (:v1, '2026-04-04 14:00+00'), (:v1, '2026-04-04 14:30+00'),
 -- 04-05: 30 minutes and 1 second apart is two bursts: 15 + 15 = 30
 (:v1, '2026-04-05 14:00:00+00'), (:v1, '2026-04-05 14:30:01+00'),
 -- 04-07: three photos at one instant: one burst, max(0, 15) + 10 = 25
 (:v1, '2026-04-07 16:00+00'), (:v1, '2026-04-07 16:00+00'), (:v1, '2026-04-07 16:00+00'),
 -- 04-08 23:50 and 04-09 00:10 are two days: 15 + 15
 (:v1, '2026-04-08 23:50+00'), (:v1, '2026-04-09 00:10+00'),
 -- undated photos never count
 (:v1, NULL), (:v1, NULL),
 -- another vehicle's photos never count for V1
 (:v2, '2026-04-01 09:00+00'), (:v2, '2026-04-03 08:00+00');
-- 04-06: 45 photos 31 minutes apart: 45 bursts x 15 = 675, capped at 480
INSERT INTO public.vehicle_images (vehicle_id, taken_at)
  SELECT :v1, '2026-04-06 00:00+00'::timestamptz + (g * interval '31 minutes') FROM generate_series(0, 44) g;
-- V4: two photos anon may see (04-10 09:00, 09:10) and three it may not (09:20, 09:25, and 04-11 10:00)
INSERT INTO public.vehicle_images (vehicle_id, taken_at, hidden) VALUES
 (:v4, '2026-04-10 09:00+00', false), (:v4, '2026-04-10 09:10+00', false),
 (:v4, '2026-04-10 09:20+00', true), (:v4, '2026-04-10 09:25+00', true), (:v4, '2026-04-11 10:00+00', true);

-- 1. Before: what the live function answers, for every vehicle and several gaps (NULL included), as the owner and as anon.
CREATE TABLE public.t_before (vid uuid, gap integer, who text, total bigint);
GRANT INSERT ON public.t_before TO anon;
INSERT INTO public.t_before
  SELECT v, g, 'owner', public.compute_active_minutes_burst_total(v, g)
  FROM (VALUES (:v1::uuid), (:v2::uuid), (:v3::uuid), (:v4::uuid)) a(v), (VALUES (30), (60), (5), (1000), (NULL::int)) b(g);
SET ROLE anon;
INSERT INTO public.t_before
  SELECT v, g, 'anon', public.compute_active_minutes_burst_total(v, g)
  FROM (VALUES (:v1::uuid), (:v4::uuid)) a(v), (VALUES (30), (60)) b(g);
RESET ROLE;
SELECT public.t_assert((SELECT total FROM public.t_before WHERE vid = :v1 AND gap = 30 AND who = 'owner') = 715,
  'before: V1 at the default gap is 30 + 65 + 15 + 40 + 30 + 480 + 25 + 15 + 15 = 715');
CREATE TABLE public.t_props_before AS
  SELECT p.prosecdef, p.provolatile, pg_get_function_result(p.oid) AS result, pg_get_function_arguments(p.oid) AS args,
         has_function_privilege('anon', p.oid, 'execute') AS anon_exec
  FROM pg_proc p WHERE p.oid = 'public.compute_active_minutes_burst_total(uuid,integer)'::regprocedure;

-- 2. The migration.
\ir ../migrations/20261014051500_burst_total_one_pass.sql

-- 3. After: the same totals, every vehicle, every gap, owner and anon.
CREATE TABLE public.t_after (vid uuid, gap integer, who text, total bigint);
GRANT INSERT ON public.t_after TO anon;
INSERT INTO public.t_after
  SELECT v, g, 'owner', public.compute_active_minutes_burst_total(v, g)
  FROM (VALUES (:v1::uuid), (:v2::uuid), (:v3::uuid), (:v4::uuid)) a(v), (VALUES (30), (60), (5), (1000), (NULL::int)) b(g);
SET ROLE anon;
INSERT INTO public.t_after
  SELECT v, g, 'anon', public.compute_active_minutes_burst_total(v, g)
  FROM (VALUES (:v1::uuid), (:v4::uuid)) a(v), (VALUES (30), (60)) b(g);
RESET ROLE;
SELECT public.t_assert(NOT EXISTS (SELECT * FROM public.t_before EXCEPT SELECT * FROM public.t_after)
  AND NOT EXISTS (SELECT * FROM public.t_after EXCEPT SELECT * FROM public.t_before)
  AND (SELECT count(*) FROM public.t_before) = (SELECT count(*) FROM public.t_after), 'after: identical totals for every vehicle, gap and role');
SELECT public.t_assert(public.compute_active_minutes_burst_total(:v1) = 715, 'after: the default gap of 30 is kept, and V1 is 715 by hand');
SELECT public.t_assert(public.compute_active_minutes_burst_total(:v2) = 30 AND public.compute_active_minutes_burst_total(:v3) = 0,
  'after: another vehicle counts only its own photos (15 + 15) and a vehicle with none is 0, not NULL');
SELECT public.t_assert((SELECT total FROM public.t_after WHERE vid = :v1 AND gap IS NULL AND who = 'owner') IS NOT NULL,
  'after: a NULL gap returns what the live function returned');

-- 4. Still SECURITY INVOKER: anon sees only the photos its policy lets through (20), the owner sees all five (50).
SELECT public.t_assert((SELECT total FROM public.t_after WHERE vid = :v4 AND gap = 30 AND who = 'anon') = 20
  AND (SELECT total FROM public.t_after WHERE vid = :v4 AND gap = 30 AND who = 'owner') = 50,
  'after: V4 is 20 for anon (two visible photos: 20) and 50 for the owner (09:00-09:25 is 35, 04-11 is 15)');

-- 5. Shape and rights are as they were.
SELECT public.t_assert((SELECT (prosecdef, provolatile, result, args, anon_exec) FROM public.t_props_before)
  = (SELECT (p.prosecdef, p.provolatile, pg_get_function_result(p.oid), pg_get_function_arguments(p.oid), has_function_privilege('anon', p.oid, 'execute'))
       FROM pg_proc p WHERE p.oid = 'public.compute_active_minutes_burst_total(uuid,integer)'::regprocedure),
  'after: invoker, stable, bigint, the default gap, anon EXECUTE unchanged');
SELECT public.t_assert((SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.compute_active_minutes_burst_total(uuid,integer)'::regprocedure),
  'after: SECURITY INVOKER and STABLE');
SELECT public.t_assert(pg_get_functiondef('public.compute_active_minutes_burst_total(uuid,integer)'::regprocedure) NOT LIKE '%compute_active_minutes_burst(%',
  'after: the total no longer calls the per-day function');

-- 6. A second run is a no-op that passes the guard.
\ir ../migrations/20261014051500_burst_total_one_pass.sql
SELECT public.t_assert(public.compute_active_minutes_burst_total(:v1) = 715, 'a re-run leaves the answer alone');

-- 7. A drifted source stops the migration and is left as found.
CREATE OR REPLACE FUNCTION public.compute_active_minutes_burst_total(p_vehicle_id uuid, p_burst_gap_minutes integer DEFAULT 30)
 RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT 123::bigint WHERE p_vehicle_id IS NOT NULL $f$;
\echo 'Expected: the source guard ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014051500_burst_total_one_pass.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.compute_active_minutes_burst_total(:v1) = 123, 'a drifted function is not replaced');
SELECT 'burst total one-pass contract: PASS' AS result;
