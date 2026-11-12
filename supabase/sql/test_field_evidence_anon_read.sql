-- Isolated PostgreSQL 17 contract for 20261008018000_field_evidence_anon_read_private_sources.sql. Synthetic rows only.
--   createdb dm_refinement_field_evidence_read_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_field_evidence_read_ci -f supabase/sql/test_field_evidence_anon_read.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.field_evidence') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE TABLE public.field_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text, proposed_value text, source_type text, created_at timestamptz DEFAULT now());
ALTER TABLE public.field_evidence ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.field_evidence TO anon, authenticated, service_role;
CREATE POLICY "Anyone can view evidence" ON public.field_evidence FOR SELECT USING (true);
CREATE POLICY "Service role manages evidence" ON public.field_evidence FOR ALL TO service_role USING (true);
INSERT INTO public.field_evidence (field_name, proposed_value, source_type) VALUES
  ('mileage', '84000', 'bat_listing'), ('engine', 'LS1', 'mecum_listing'),
  ('Vendor X 2026-01-05', '1234.56', 'quickbooks'), ('Shop Y 2026-02-01', '88.00', 'invoice'), ('Store Z 2026-03-01', '12.00', 'email_receipt'),
  ('seller_name', 'A Person', 'fb_marketplace_listing'), ('price', '15000', 'fb_marketplace_listing'), ('seller_name', 'Another Person', 'craigslist_listing');
SET ROLE anon;
SELECT pg_temp.ok('fixture reproduces the exposure: anon reads all 8 rows before the migration', (SELECT count(*) FROM public.field_evidence) = 8);
RESET ROLE;
\ir ../migrations/20261008018000_field_evidence_anon_read_private_sources.sql
SET ROLE anon;
SELECT pg_temp.ok('anon reads the listing facts (incl. the FB price) and none of the money rows or person-name fields',
  (SELECT count(*) FROM public.field_evidence) = 3
  AND (SELECT count(*) FROM public.field_evidence WHERE source_type IN ('quickbooks','invoice','email_receipt')) = 0
  AND (SELECT count(*) FROM public.field_evidence WHERE field_name = 'seller_name') = 0
  AND (SELECT count(*) FROM public.field_evidence WHERE source_type = 'fb_marketplace_listing' AND field_name = 'price') = 1);
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.ok('a signed-in reader still reads every row', (SELECT count(*) FROM public.field_evidence) = 8);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.ok('service_role reads every row', (SELECT count(*) FROM public.field_evidence) = 8);
RESET ROLE;
\ir ../migrations/20261008018000_field_evidence_anon_read_private_sources.sql
SELECT pg_temp.ok('re-apply changes nothing', (SELECT count(*) FROM pg_policies WHERE tablename = 'field_evidence') = 2);

-- 20261116014000: money rows only for viewers tied to their vehicle. The owner is bbbb…, an untied account cccc….
-- vehicle_listing_viewer_tied is the live definition (20261110100000); vehicle_user_has_access is a stub that grants
-- access to nobody beyond the vehicle's own people (the live one adds admins, permissions and contributors).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, owner_id uuid, user_id uuid, created_by_user_id uuid, uploaded_by uuid);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id AND p_user_id IN (v.user_id, v.owner_id, v.uploaded_by)) $$;
CREATE OR REPLACE FUNCTION public.vehicle_listing_viewer_tied(p_vehicle_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT (SELECT auth.role()) = 'service_role'
      OR EXISTS (SELECT 1 FROM public.vehicles v
                 WHERE v.id = p_vehicle_id AND (SELECT auth.uid()) IS NOT NULL
                   AND (coalesce((SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                        OR public.vehicle_user_has_access(v.id, (SELECT auth.uid()))))
$f$;
GRANT EXECUTE ON FUNCTION public.vehicle_listing_viewer_tied(uuid) TO anon, authenticated, service_role;
INSERT INTO public.vehicles (id, owner_id) VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('22222222-2222-2222-2222-222222222222', NULL);
UPDATE public.field_evidence SET vehicle_id = '11111111-1111-1111-1111-111111111111';
-- A money row on a vehicle with no person: nobody signed in is tied to it.
INSERT INTO public.field_evidence (vehicle_id, field_name, proposed_value, source_type)
  VALUES ('22222222-2222-2222-2222-222222222222', 'Vendor W 2026-04-01', '5.00', 'quickbooks');

\ir ../migrations/20261116014000_field_evidence_financial_rows_tied_only.sql
\ir ../migrations/20261116014000_field_evidence_financial_rows_tied_only.sql

SET ROLE anon;
SELECT pg_temp.ok('014000: anon unchanged: the 3 listing facts, no money row, no person-name field',
  (SELECT count(*) FROM public.field_evidence) = 3
  AND (SELECT count(*) FROM public.field_evidence WHERE source_type IN ('quickbooks','invoice','email_receipt')) = 0);
RESET ROLE;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL test.auth_uid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SELECT pg_temp.ok('014000: an untied signed-in reader sees 0 money rows and every other row (5)',
  (SELECT count(*) FILTER (WHERE source_type IN ('quickbooks','invoice','email_receipt')) FROM public.field_evidence) = 0
  AND (SELECT count(*) FROM public.field_evidence) = 5);
SET LOCAL test.auth_uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
SELECT pg_temp.ok('014000: the owner sees all 3 money rows of their vehicle and not the other vehicle''s',
  (SELECT count(*) FILTER (WHERE source_type IN ('quickbooks','invoice','email_receipt')) FROM public.field_evidence) = 3
  AND (SELECT count(*) FROM public.field_evidence) = 8);
COMMIT;
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.ok('014000: service_role reads every row (9)', (SELECT count(*) FROM public.field_evidence) = 9);
RESET ROLE;
SELECT pg_temp.ok('014000: re-apply changes nothing', (SELECT count(*) FROM pg_policies WHERE tablename = 'field_evidence') = 2);
\echo 'field_evidence anon read contract: all checks passed'
