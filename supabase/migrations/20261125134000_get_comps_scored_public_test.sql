-- get_comps_scored_public_test_v1: both get_comps_scored overloads state the whole visibility test on vehicles.
--
-- WHY. get_comps_scored is a SECURITY DEFINER reader anon executes (the iOS worth bracket, and get_comps_combined for
-- the connector's listing advisor). Its comp_ids pre-filter read every vehicle of the make, so a private or deleted car
-- came back as a comp with its id, VIN, image, location and listing URL. Live 2026-11-25, the basis overload for a
-- 1973 Pontiac Firebird returned 50 comps, 1 not public and 2 deleted. The text overload has no deleted test anywhere,
-- and the basis overload has one only on its vehicle-event branch.
--
-- WHAT CHANGES. In each overload, the comp_ids pre-filter gains `AND vv.is_public = true AND vv.deleted_at IS NULL`.
-- Both candidate branches (auction events, vehicle records) join comp_ids, so the test holds for every row returned.
-- Nothing else in the bodies changes: each is patched in place from its live definition by one anchor that must occur
-- exactly once. Security, settings and grants are kept by CREATE OR REPLACE. get_comps_combined (both overloads) reads
-- through get_comps_scored and needs no change.
-- Contract: supabase/sql/test_get_comps_scored_public_test.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  f regprocedure;
  d text;
  anchor constant text := E'SELECT vv.id FROM public.vehicles vv\n    WHERE lower(vv.make) = lower(p_make)';
  added constant text := ' AND vv.is_public = true AND vv.deleted_at IS NULL';
  n int;
  patched int := 0;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_comps_scored' LOOP
    d := pg_get_functiondef(f);
    IF position(anchor || added IN d) > 0 THEN
      patched := patched + 1;  -- already applied
      CONTINUE;
    END IF;
    n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    IF n <> 1 THEN
      RAISE EXCEPTION 'get_comps_scored_public_test: % holds the comp_ids anchor % times, expected 1', f, n;
    END IF;
    EXECUTE replace(d, anchor, anchor || added);
    patched := patched + 1;
  END LOOP;
  IF patched <> 2 THEN
    RAISE EXCEPTION 'get_comps_scored_public_test: patched % overloads, expected 2', patched;
  END IF;
END
$patch$;
