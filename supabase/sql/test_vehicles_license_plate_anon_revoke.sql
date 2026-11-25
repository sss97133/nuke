-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_plates_<n> -f supabase/sql/test_vehicles_license_plate_anon_revoke.sql
-- Proves 20261125152500_vehicles_license_plate_anon_revoke.sql: anon can no longer select vehicles.license_plate (42501),
-- still reads the public columns it held (an explicit column list, filters, count), authenticated keeps the plate, the
-- migration is idempotent, and the revert restores anon's column grant. The fixture mirrors production on 2026-11-24:
-- anon and authenticated hold column grants on vehicles (no table SELECT), with owner_name already withheld.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year int, make text, model text, is_public boolean, deleted_at timestamptz,
  license_plate text, owner_name text);
GRANT SELECT (id, year, make, model, is_public, deleted_at, license_plate) ON public.vehicles TO anon, authenticated;
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated;
-- Made-up values.
INSERT INTO public.vehicles VALUES ('a0000000-0000-0000-0000-00000000000a', 1973, 'Test', 'Car', true, NULL, 'TST0001', 'nobody');

SELECT t_assert(has_column_privilege('anon', 'public.vehicles', 'license_plate', 'SELECT'), 'before: anon holds the plate column');

\ir ../migrations/20261125152500_vehicles_license_plate_anon_revoke.sql
\ir ../migrations/20261125152500_vehicles_license_plate_anon_revoke.sql
RESET statement_timeout; RESET lock_timeout;

SET ROLE anon;
DO $$ BEGIN
  PERFORM license_plate FROM public.vehicles;
  RAISE EXCEPTION 'FAIL: anon selected vehicles.license_plate';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon select of license_plate is refused (42501)';
END $$;
DO $$ BEGIN
  PERFORM 1 FROM public.vehicles WHERE license_plate IS NOT NULL;
  RAISE EXCEPTION 'FAIL: anon filtered on vehicles.license_plate';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon filter on license_plate is refused (42501)';
END $$;
SELECT t_assert((SELECT count(*) FROM (SELECT id, year, make, model FROM public.vehicles WHERE is_public AND deleted_at IS NULL) s) = 1,
  'anon: the public column list, filters and count still read');
RESET ROLE;

SET ROLE authenticated;
SELECT t_assert((SELECT count(license_plate) FROM public.vehicles) = 1, 'authenticated: keeps the plate column');
RESET ROLE;

\ir revert_20261125152500_vehicles_license_plate_anon_revoke.sql
SELECT t_assert(has_column_privilege('anon', 'public.vehicles', 'license_plate', 'SELECT'), 'revert: anon holds the plate column again');
