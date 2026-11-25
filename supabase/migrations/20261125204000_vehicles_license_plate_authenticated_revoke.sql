-- vehicles.license_plate: revoke SELECT from authenticated.
--
-- WHY. A plate identifies a car on the road and, through registration, its keeper. 20261125152500 revoked it from anon,
-- but every signed-in account could still read every car's plate directly over PostgREST
-- (has_column_privilege('authenticated', vehicles.license_plate, 'SELECT') was true on 2026-11-25).
--
-- WHAT. The column grant goes. Owners and tied viewers read their car's plate through vehicle_row_read, which hands
-- insiders the whole row and, since 20261125202000, nulls for everyone else each column their role cannot SELECT.
-- Consumers, by column-level grep of the web, iOS, edge functions and nuke_frontend/api on 2026-11-25: the one direct
-- signed-in select (InvoiceManager's embed) moved to vehicle_row_read in #3927, which must be live before this deploys;
-- the edit forms already read vehicle_row_read; the rest write the column or never read it. Nothing on the database
-- reads the column as authenticated: the one view naming it (vehicles_inventory) is granted to neither role, no policy
-- names it, and every invoker function naming license_plate reads it out of jsonb, not this column. Whole-row reads
-- (select=*, to_jsonb(v.*)) by authenticated already fail on the 29 columns denied before this one.
-- Guards: authenticated must hold no table-level SELECT (a column revoke would otherwise change nothing), and the
-- projection must already carry 20261125202000's marker, or the definer readers would keep handing plates to strangers.
-- CONTRACT: supabase/sql/test_vehicles_license_plate_authenticated_revoke.sql (PG17).
-- REVERSAL: GRANT SELECT (license_plate) ON public.vehicles TO authenticated; (through a migration).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF has_table_privilege('authenticated', 'public.vehicles', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated holds table-level SELECT on vehicles; a column revoke would not close license_plate';
  END IF;
  IF position('vehicle_row_projection_withheld_columns_v1' in
       pg_get_functiondef('public.vehicle_row_public_projection(jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'vehicle_row_public_projection does not mask by grant yet (20261125202000); revoking now leaves the readers handing plates to signed-in strangers';
  END IF;
END $guard$;

REVOKE SELECT (license_plate) ON public.vehicles FROM authenticated;

DO $check$
BEGIN
  IF has_column_privilege('authenticated', 'public.vehicles', 'license_plate', 'SELECT')
     OR has_column_privilege('anon', 'public.vehicles', 'license_plate', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.vehicles', 'make', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.vehicles', 'license_plate', 'SELECT') THEN
    RAISE EXCEPTION 'license_plate grants not as intended';
  END IF;
END $check$;
COMMIT;
