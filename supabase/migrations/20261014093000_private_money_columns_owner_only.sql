-- The owner's money columns on organization_vehicles and vehicles are no longer readable by anon or authenticated.
--
-- Measured 2026-10-14 as the anon role (counts only): organization_vehicles cost_basis 14 rows (all organization
-- c433d27e), sale_price 592, asking_price 87, internal_notes 0; vehicles purchase_price 39, purchase_date 5,
-- purchase_location 28 (52 public vehicles). Row policies admit the rows (organization_vehicles: USING (true); every
-- public vehicle) and the table-wide SELECT grant admitted every column.
--
-- Now anon and authenticated lose the table-wide SELECT on both tables and keep SELECT on every other column, listed
-- from pg_attribute when this applies (339 of the 342 vehicles columns, 36 of the 40 organization_vehicles columns).
-- INSERT, UPDATE and DELETE are unchanged; row policies still decide them. The service role keeps everything.
-- Owners read the money through organization_vehicle_books, vehicle_owner_books and vehicle_row_read
-- (20261014073000_private_money_readers). The web stopped selecting these columns, and '*' on either table, in #1167;
-- that deploy must be live before this applies, or every page still selecting '*' fails.
--
-- A column added to either table later is not readable by anon or authenticated until a migration grants it.
-- Contract: supabase/sql/test_private_money_columns_owner_only.sql (CI job private-money-columns-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF to_regprocedure('public.organization_vehicle_books(uuid)') IS NULL
     OR to_regprocedure('public.vehicle_owner_books(uuid[])') IS NULL
     OR to_regprocedure('public.vehicle_row_read(uuid)') IS NULL THEN
    RAISE EXCEPTION 'the owner readers of 20261014073000_private_money_readers are not applied';
  END IF;
END $guard$;

DO $grants$
DECLARE
  t record;
  v_open text;
  v_private text;
  v_found int;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('organization_vehicles', ARRAY['cost_basis', 'sale_price', 'asking_price', 'internal_notes']),
      ('vehicles', ARRAY['purchase_price', 'purchase_date', 'purchase_location'])) AS v(tbl, private_cols)
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) FILTER (WHERE a.attname <> ALL (t.private_cols)),
           string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) FILTER (WHERE a.attname = ANY (t.private_cols)),
           count(*) FILTER (WHERE a.attname = ANY (t.private_cols))
      INTO v_open, v_private, v_found
    FROM pg_attribute a
    WHERE a.attrelid = format('public.%I', t.tbl)::regclass AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_found <> cardinality(t.private_cols) THEN
      RAISE EXCEPTION '%: expected the private columns %, found %', t.tbl, t.private_cols, v_found;
    END IF;
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', t.tbl);
    EXECUTE format('REVOKE SELECT (%s) ON public.%I FROM anon, authenticated', v_private, t.tbl);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO anon, authenticated', v_open, t.tbl);
  END LOOP;
END $grants$;

-- This migration's own result.
DO $check$
BEGIN
  IF has_column_privilege('anon', 'public.organization_vehicles', 'cost_basis', 'SELECT')
     OR has_column_privilege('authenticated', 'public.organization_vehicles', 'sale_price', 'SELECT')
     OR has_column_privilege('anon', 'public.organization_vehicles', 'asking_price', 'SELECT')
     OR has_column_privilege('authenticated', 'public.organization_vehicles', 'internal_notes', 'SELECT')
     OR has_column_privilege('anon', 'public.vehicles', 'purchase_price', 'SELECT')
     OR has_column_privilege('authenticated', 'public.vehicles', 'purchase_date', 'SELECT')
     OR has_column_privilege('anon', 'public.vehicles', 'purchase_location', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.vehicles', 'make', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.organization_vehicles', 'notes', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.vehicles', 'UPDATE')
     OR NOT has_column_privilege('service_role', 'public.vehicles', 'purchase_price', 'SELECT')
     OR (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = 'public.vehicles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
           AND NOT has_column_privilege('anon', 'public.vehicles', a.attname, 'SELECT')) <> 3
     OR (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = 'public.organization_vehicles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
           AND NOT has_column_privilege('authenticated', 'public.organization_vehicles', a.attname, 'SELECT')) <> 4 THEN
    RAISE EXCEPTION 'private money column grants did not land as written';
  END IF;
END $check$;

COMMIT;
