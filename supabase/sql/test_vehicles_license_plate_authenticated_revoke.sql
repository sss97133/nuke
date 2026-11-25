-- Empty disposable PG17 only:
--   createdb dm_refinement_row_projection; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_row_projection -f this-file.sql
--   (-v revoke=<path> runs the contract against another migration; the mutation runs use it.)
-- Proves 20261125204000_vehicles_license_plate_authenticated_revoke.sql: a signed-in stranger can no longer select
-- vehicles.license_plate directly (42501) or read it through vehicle_row_read; the owner, a tied contributor and the
-- service role still read it through the reader; the other authenticated columns are untouched; and the migration
-- refuses to run while the projection does not yet mask by grant.
-- Builds on the projection contract, which leaves its fixture (vehicles, grants as live, the live readers) in place.
\set ON_ERROR_STOP on
\if :{?revoke}
\else
  \set revoke ../migrations/20261125204000_vehicles_license_plate_authenticated_revoke.sql
\endif
\ir test_vehicle_row_projection_withheld_columns.sql

-- 0. The guard: with the prior projection back in place, the revoke refuses and changes nothing.
\ir revert_20261125202000_vehicle_row_projection_withheld_columns.sql
\set ON_ERROR_STOP off
\ir :revoke
\set ON_ERROR_STOP on
ROLLBACK;
DO $$ BEGIN
  ASSERT has_column_privilege('authenticated', 'public.vehicles', 'license_plate', 'SELECT'),
    '0 the revoke refuses while the projection does not mask by grant';
END $$;
\ir ../migrations/20261125202000_vehicle_row_projection_withheld_columns.sql

\ir :revoke
\ir :revoke

-- 1. Grants: closed to anon and authenticated, open to service_role, other columns unchanged.
DO $$ BEGIN
  ASSERT NOT has_column_privilege('authenticated', 'public.vehicles', 'license_plate', 'SELECT'), '1 authenticated revoked';
  ASSERT NOT has_column_privilege('anon', 'public.vehicles', 'license_plate', 'SELECT'), '1 anon still revoked';
  ASSERT has_column_privilege('service_role', 'public.vehicles', 'license_plate', 'SELECT'), '1 service_role keeps it';
  ASSERT has_column_privilege('authenticated', 'public.vehicles', 'make', 'SELECT')
     AND has_column_privilege('authenticated', 'public.vehicles', 'description', 'SELECT'), '1 other columns unchanged';
END $$;

-- 2. A signed-in direct select of the plate fails with 42501; a select of granted columns still works.
BEGIN;
SELECT public.t_claims('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  BEGIN
    PERFORM license_plate FROM public.vehicles;
    RAISE EXCEPTION 'direct select of license_plate succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT count(*) INTO n FROM public.vehicles WHERE make = 'Fixture';
  ASSERT n = 2, '2 granted columns still selectable';
END $$;
COMMIT;

-- 3. Through the reader: the stranger and anon get null, insiders and service read it.
CREATE TABLE public.rv_answers (caller text PRIMARY KEY, plate jsonb);
GRANT INSERT ON public.rv_answers TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.plate_as(p_caller text, p_uid text, p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.t_claims(p_uid);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  INSERT INTO public.rv_answers SELECT p_caller, public.vehicle_row_read('11111111-1111-4111-8111-111111111111')->'license_plate';
  RESET ROLE;
END $$;
BEGIN;
SELECT pg_temp.plate_as('anon', '', 'anon');
SELECT pg_temp.plate_as('stranger', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'authenticated');
SELECT pg_temp.plate_as('owner', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated');
SELECT pg_temp.plate_as('contributor', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated');
SELECT pg_temp.plate_as('service', 'service', 'service_role');
COMMIT;
DO $$ BEGIN
  ASSERT (SELECT plate FROM public.rv_answers WHERE caller = 'anon') = 'null'::jsonb, '3 anon reads no plate';
  ASSERT (SELECT plate FROM public.rv_answers WHERE caller = 'stranger') = 'null'::jsonb, '3 stranger reads no plate';
  ASSERT (SELECT plate->>0 FROM (SELECT jsonb_build_array(plate) plate FROM public.rv_answers WHERE caller = 'owner') x) = 'FIXTURE1', '3 owner reads the plate';
  ASSERT (SELECT plate->>0 FROM (SELECT jsonb_build_array(plate) plate FROM public.rv_answers WHERE caller = 'contributor') x) = 'FIXTURE1', '3 tied contributor reads the plate';
  ASSERT (SELECT plate->>0 FROM (SELECT jsonb_build_array(plate) plate FROM public.rv_answers WHERE caller = 'service') x) = 'FIXTURE1', '3 service reads the plate';
END $$;
SELECT 'PASS: license_plate revoked from authenticated; owners read it through vehicle_row_read' AS result;
