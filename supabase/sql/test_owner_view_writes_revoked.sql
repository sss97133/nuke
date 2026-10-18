-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_owner_views -f this-file.sql
-- Contract for 20261014124500_owner_view_writes_revoked.sql. Synthetic rows only; never production.
-- Two of the listed views, built from their production definitions (2026-10-14) over row-secured tables the view
-- owner owns, prove the hole and its repair:
--   * before: with the default grants, anon deletes, updates and inserts base rows through the views although the
--     base tables' row policies refuse the same statements made on the tables directly;
--   * after: anon and authenticated get insufficient_privilege on every write through the views, still read them,
--     and the service role keeps its writes; views missing from the database are skipped; the migration is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role, dm_contract_deployer;
-- Prod's deploy role owns the tables and views and is not a superuser; build and migrate as one.
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- denied(sql) is true when the statement fails with insufficient_privilege (42501).
CREATE FUNCTION pg_temp.denied(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN true;
END $$;
-- rows(sql) runs a write and returns how many rows it touched, then undoes it.
CREATE FUNCTION pg_temp.rows(p_sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001', DETAIL = n::text;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS p_sql = PG_EXCEPTION_DETAIL;
    RETURN p_sql::integer;
  END;
END $$;

-- Base tables with row security (reads for everyone, writes for the owner only), and the default API grants.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, series text, "trim" text,
  body_style text, is_public boolean NOT NULL DEFAULT true, user_id uuid);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  image_url text, file_name text, ai_processing_status text, ai_processing_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (is_public = true);
CREATE POLICY vehicles_owner_write ON public.vehicles FOR ALL USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY images_public_select ON public.vehicle_images FOR SELECT USING (true);
CREATE POLICY images_owner_write ON public.vehicle_images FOR ALL USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Production definitions (pg_get_viewdef, 2026-10-14).
CREATE VIEW public.vehicle_display_names AS
 SELECT id, year, make, model, series, "trim", body_style,
    concat_ws(' '::text, year, make, COALESCE(series, model)) AS short_name,
    concat_ws(' '::text, year, make, COALESCE(series, model), body_style, "trim") AS full_name,
    concat_ws(' '::text, year, make, COALESCE(series, model),
      CASE WHEN ((body_style IS NOT NULL) AND (body_style <> model)) THEN body_style ELSE NULL::text END) AS display_name
   FROM vehicles v;
CREATE VIEW public.ai_processing_queue AS
 SELECT id, user_id, image_url, file_name, ai_processing_status, ai_processing_started_at, created_at,
    (EXTRACT(epoch FROM (now() - created_at)) / (60)::numeric) AS minutes_waiting
   FROM vehicle_images
  WHERE (ai_processing_status = ANY (ARRAY['pending'::text, 'processing'::text]))
  ORDER BY created_at;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

INSERT INTO public.vehicles (id, year, make, model, user_id) VALUES
 ('10000000-0000-0000-0000-000000000001', 1972, 'Chevrolet', 'K5', '20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002', 1967, 'Ford', 'Mustang', '20000000-0000-0000-0000-000000000002');
INSERT INTO public.vehicle_images (vehicle_id, user_id, image_url, ai_processing_status) VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'https://example.invalid/a.jpg', 'pending');

-- 1. Before: the base tables refuse a stranger, the views do not.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
SELECT pg_temp.ok('before: row policies refuse anon deletes on the base tables',
  pg_temp.rows($q$DELETE FROM public.vehicles$q$) = 0
  AND pg_temp.rows($q$DELETE FROM public.vehicle_images$q$) = 0);
SELECT pg_temp.ok('before: anon deletes, updates and inserts base rows through the views',
  pg_temp.rows($q$DELETE FROM public.vehicle_display_names$q$) = 2
  AND pg_temp.rows($q$UPDATE public.vehicle_display_names SET make = 'Vandal'$q$) = 2
  AND pg_temp.rows($q$INSERT INTO public.vehicle_display_names (id, make, model) VALUES (gen_random_uuid(), 'Fake', 'Car')$q$) = 1
  AND pg_temp.rows($q$DELETE FROM public.ai_processing_queue$q$) = 1);
RESET ROLE;

SET ROLE dm_contract_deployer;
\ir ../migrations/20261014124500_owner_view_writes_revoked.sql
-- A second application changes nothing and passes its own check.
\ir ../migrations/20261014124500_owner_view_writes_revoked.sql

-- 2. After: no write through the views for anon or authenticated; reads unchanged.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
SELECT pg_temp.ok('anon: every write through the views is denied',
  pg_temp.denied($q$DELETE FROM public.vehicle_display_names$q$)
  AND pg_temp.denied($q$UPDATE public.vehicle_display_names SET make = 'Vandal'$q$)
  AND pg_temp.denied($q$INSERT INTO public.vehicle_display_names (id, make, model) VALUES (gen_random_uuid(), 'Fake', 'Car')$q$)
  AND pg_temp.denied($q$DELETE FROM public.ai_processing_queue$q$)
  AND pg_temp.denied($q$UPDATE public.ai_processing_queue SET file_name = 'x'$q$));
SELECT pg_temp.ok('anon: the views still read',
  (SELECT count(*) FROM public.vehicle_display_names) = 2
  AND (SELECT display_name FROM public.vehicle_display_names WHERE id = '10000000-0000-0000-0000-000000000001') = '1972 Chevrolet K5'
  AND (SELECT count(*) FROM public.ai_processing_queue) = 1);
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000001', false);
SELECT pg_temp.ok('authenticated, even the owner: writes through the views are denied, reads work',
  pg_temp.denied($q$DELETE FROM public.vehicle_display_names WHERE id = '10000000-0000-0000-0000-000000000001'$q$)
  AND pg_temp.denied($q$UPDATE public.ai_processing_queue SET file_name = 'x'$q$)
  AND (SELECT count(*) FROM public.vehicle_display_names) = 2);
SELECT pg_temp.ok('the owner still writes the base table under its row policies',
  pg_temp.rows($q$UPDATE public.vehicles SET model = 'K5 Blazer' WHERE id = '10000000-0000-0000-0000-000000000001'$q$) = 1
  AND pg_temp.rows($q$UPDATE public.vehicles SET model = 'Mustang GT' WHERE id = '10000000-0000-0000-0000-000000000002'$q$) = 0);
RESET ROLE;

SELECT pg_temp.ok('service role keeps its writes and reads; SELECT grants are unchanged',
  has_table_privilege('service_role', 'public.vehicle_display_names', 'DELETE')
  AND has_table_privilege('service_role', 'public.ai_processing_queue', 'UPDATE')
  AND has_table_privilege('anon', 'public.vehicle_display_names', 'SELECT')
  AND has_table_privilege('authenticated', 'public.ai_processing_queue', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.vehicle_display_names', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.vehicle_display_names', 'INSERT'));
