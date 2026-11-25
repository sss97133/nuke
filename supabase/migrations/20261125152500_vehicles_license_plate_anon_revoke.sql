-- anon loses the column grant on vehicles.license_plate. Owner rule: profiles are public; privacy is line-item
-- masking inside. The plate is the line item; the car stays public, and the people tied to it (authenticated, through
-- the vehicles policies) keep reading it.
--
-- Rows: vehicles (column grants for anon; anon holds no table SELECT). Before (2026-11-24):
-- has_column_privilege('anon','public.vehicles','license_plate','SELECT') = true, with 29 of 368 columns already withheld
-- from anon (purchase_price, owner_name, owner_contact, ...). So select=* and whole-row references already fail for
-- anon, and no working anon reader depends on either.
-- Consumers checked before this migration (repo grep and live pg_proc / pg_views / pg_policies), each with its verdict,
-- are listed in the PR body. None reads vehicles.license_plate as anon.
-- Revert: supabase/sql/revert_20261125152500_vehicles_license_plate_anon_revoke.sql.
-- Test: supabase/sql/test_vehicles_license_plate_anon_revoke.sql.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$ BEGIN
  IF has_table_privilege('anon', 'public.vehicles', 'SELECT') THEN
    RAISE EXCEPTION 'anon holds table SELECT on vehicles; a column revoke would not withhold license_plate';
  END IF;
END $$;

REVOKE SELECT (license_plate) ON public.vehicles FROM anon;
REVOKE SELECT (license_plate) ON public.vehicles FROM PUBLIC;

DO $$ BEGIN
  IF has_column_privilege('anon', 'public.vehicles', 'license_plate', 'SELECT') THEN
    RAISE EXCEPTION 'anon still reads vehicles.license_plate after the revoke';
  END IF;
  IF NOT has_column_privilege('anon', 'public.vehicles', 'id', 'SELECT') THEN
    RAISE EXCEPTION 'anon lost vehicles.id';
  END IF;
END $$;

RESET statement_timeout;
RESET lock_timeout;
