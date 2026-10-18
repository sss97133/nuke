-- 20261008012000_material_defaults_write_grants.sql
--
-- Close the anonymous write door on the one owner-controlled public table that has no row security.
-- A read-only grants sweep on 2026-10-07 13:43Z found 2 of 931 public base tables with RLS off: spatial_ref_sys (the PostGIS
-- SRID catalog, owned by supabase_admin: its grants are the platform's and cannot be revoked by the deploy role; listed for
-- the owner) and material_defaults (owned by postgres: 13 rows of CAD material defaults, never analyzed, no reader or writer
-- in code; anon and authenticated held INSERT, UPDATE, DELETE and TRUNCATE on it through Supabase's default privileges, so
-- anyone with the public key could rewrite or empty it through the REST API).
--
-- WHAT: REVOKE the four write privileges from anon and authenticated on public.material_defaults; SELECT stays (reference
-- data, no personal content); RLS stays off (enabling it with no policy would hide the rows from the API, and nothing
-- needs that). A guard fails the apply if either role can still write. Idempotent.
-- Reversal: GRANT INSERT, UPDATE, DELETE ON public.material_defaults TO authenticated;
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.material_defaults FROM anon, authenticated;

COMMENT ON TABLE public.material_defaults IS
'CAD material defaults: one row per material (13 rows on 2026-10-07) with pierceable, thermal_max_c, hot_surface, vibration_class, reachable_score, noise_emission and notes. Reference data for the wiring and CAD lanes; no reader or writer in code on 2026-10-07. RLS off; anon and authenticated read only since 2026-10-07 (20261008012000 revoked their write grants). Writer: migrations. Grain: one material. Clock: created_at.';

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.material_defaults', 'INSERT') OR has_table_privilege('anon', 'public.material_defaults', 'DELETE')
     OR has_table_privilege('authenticated', 'public.material_defaults', 'UPDATE') OR has_table_privilege('authenticated', 'public.material_defaults', 'TRUNCATE') THEN
    RAISE EXCEPTION 'material_defaults is still writable by an API role';
  END IF;
  RAISE NOTICE 'material_defaults: API roles read only';
END $$;

COMMIT;
