-- Disposable PG17 contract for 20261125095500_viewer_tie_plpgsql (vehicle_viewer_tie_plpgsql_v1). Synthetic rows only.
-- Builds the access fixture of test_vehicle_access_requires_provenance.sql (owner, granted mechanic, verified claimant,
-- admin, dealer staff, self-granted strangers), installs both functions as the live SQL bodies (the revert file holds
-- them verbatim), keeps those as old_* copies, applies the migration twice, and asserts:
--   * both functions are plpgsql, STABLE, SECURITY DEFINER, with the same search_path, and their grants are unchanged;
--   * for every fixture vehicle x every account seen in the fixture (plus NULL and an unknown one) x role
--     (anon, authenticated, service_role, none), the new functions answer exactly as the SQL bodies did;
--   * the guard refuses a body it has not reviewed; the revert restores the SQL bodies.
\set ON_ERROR_STOP on
\ir test_vehicle_access_requires_provenance.sql
RESET ROLE;
\ir revert_20261125095500_viewer_tie_plpgsql.sql
GRANT EXECUTE ON FUNCTION public.vehicle_viewer_tied(uuid) TO anon, authenticated;

CREATE TEMP TABLE before_grants AS
  SELECT p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') AS x
    FROM pg_proc p CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
   WHERE p.oid IN ('public.vehicle_user_has_access(uuid,uuid)'::regprocedure, 'public.vehicle_viewer_tied(uuid)'::regprocedure);

-- Keep the SQL bodies as old_* for comparison; old_viewer_tied calls old_user_has_access.
DO $copy$
BEGIN
  EXECUTE replace(pg_get_functiondef('public.vehicle_user_has_access(uuid,uuid)'::regprocedure),
                  'public.vehicle_user_has_access(', 'public.old_user_has_access(');
  EXECUTE replace(replace(pg_get_functiondef('public.vehicle_viewer_tied(uuid)'::regprocedure),
                  'public.vehicle_viewer_tied(', 'public.old_viewer_tied('),
                  'public.vehicle_user_has_access(', 'public.old_user_has_access(');
END $copy$;

\ir ../migrations/20261125095500_viewer_tie_plpgsql.sql
\ir ../migrations/20261125095500_viewer_tie_plpgsql.sql

DO $$
DECLARE n int; bad int; checked int := 0; pos_access int := 0; pos_tied int := 0; v uuid; u uuid; rl text;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid IN ('public.vehicle_user_has_access(uuid,uuid)'::regprocedure, 'public.vehicle_viewer_tied(uuid)'::regprocedure)
     AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND p.prosecdef;
  IF n <> 2 THEN RAISE EXCEPTION 'contract failed: both functions plpgsql stable definer (got %)', n; END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid = 'public.vehicle_user_has_access(uuid,uuid)'::regprocedure) <> ARRAY['search_path=public']
     OR (SELECT proconfig FROM pg_proc WHERE oid = 'public.vehicle_viewer_tied(uuid)'::regprocedure) <> ARRAY['search_path=pg_catalog, public'] THEN
    RAISE EXCEPTION 'contract failed: search_path changed';
  END IF;
  SELECT count(*) INTO bad FROM before_grants b
   JOIN pg_proc p ON p.proname = b.proname AND p.pronamespace = 'public'::regnamespace AND p.proname IN ('vehicle_user_has_access', 'vehicle_viewer_tied')
   WHERE has_function_privilege(b.rolname, p.oid, 'execute') IS DISTINCT FROM b.x;
  IF bad > 0 THEN RAISE EXCEPTION 'contract failed: % grants changed', bad; END IF;

  FOR v IN SELECT id FROM public.vehicles UNION ALL SELECT '00000000-0000-0000-0000-00000000dead'::uuid LOOP
    FOR u IN SELECT DISTINCT x FROM (
               SELECT user_id x FROM public.vehicles UNION SELECT owner_id FROM public.vehicles UNION SELECT uploaded_by FROM public.vehicles
               UNION SELECT created_by_user_id FROM public.vehicles UNION SELECT user_id FROM public.vehicle_user_permissions
               UNION SELECT granted_by FROM public.vehicle_user_permissions UNION SELECT user_id FROM public.ownership_verifications
               UNION SELECT user_id FROM public.vehicle_contributors UNION SELECT user_id FROM public.organization_contributors
               UNION SELECT user_id FROM public.admin_users UNION SELECT '00000000-0000-0000-0000-00000000beef'::uuid
               UNION SELECT NULL::uuid) s
    LOOP
      IF public.vehicle_user_has_access(v, u) IS DISTINCT FROM public.old_user_has_access(v, u) THEN
        RAISE EXCEPTION 'contract failed: vehicle_user_has_access(%, %) changed', v, u; END IF;
      IF public.vehicle_user_has_access(v, u) THEN pos_access := pos_access + 1; END IF;
      FOREACH rl IN ARRAY ARRAY['anon', 'authenticated', 'service_role', ''] LOOP
        PERFORM set_config('test.auth_role', rl, true), set_config('test.auth_uid', coalesce(u::text, ''), true);
        IF public.vehicle_viewer_tied(v) IS DISTINCT FROM public.old_viewer_tied(v) THEN
          RAISE EXCEPTION 'contract failed: vehicle_viewer_tied(%) as % / % changed', v, rl, u; END IF;
        IF public.vehicle_viewer_tied(v) THEN pos_tied := pos_tied + 1; END IF;
        checked := checked + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  IF checked < 50 THEN RAISE EXCEPTION 'contract failed: only % cases compared', checked; END IF;
  IF pos_access = 0 OR pos_tied = 0 THEN RAISE EXCEPTION 'contract failed: no true case compared (% / %)', pos_access, pos_tied; END IF;
  RAISE NOTICE 'PASS: % tie cases identical (vehicle_user_has_access true in %, vehicle_viewer_tied true in %)', checked, pos_access, pos_tied;
END $$;

-- The guard refuses a body it has not reviewed, and then changes nothing (guard and definitions are one statement).
\ir revert_20261125095500_viewer_tie_plpgsql.sql
CREATE OR REPLACE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public' AS $function$ SELECT false $function$;
\set ON_ERROR_STOP off
\ir ../migrations/20261125095500_viewer_tie_plpgsql.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid IN ('public.vehicle_user_has_access(uuid,uuid)'::regprocedure, 'public.vehicle_viewer_tied(uuid)'::regprocedure)
         AND l.lanname = 'sql') <> 2 THEN
    RAISE EXCEPTION 'contract failed: the guard let an unreviewed body be replaced';
  END IF;
  RAISE NOTICE 'PASS: guard refused an unreviewed body and changed nothing; revert restored SQL bodies';
END $$;
\echo viewer_tie_plpgsql: ok
