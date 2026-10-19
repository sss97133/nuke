-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_org_private -f this-file.sql
-- Proves that organizations.tax_id and business_license are editor-only: organization_private_fields_read
-- (20261020140000) returns them to whoever passes an organizations UPDATE policy and refuses everyone else, and
-- 20261020141000 removes them from the anon/authenticated column grant while businesses keeps its shape.
-- Starts from the live table, businesses view, row policies and grants (2026-10-19) and shows the leak first.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT jsonb_build_object('role', nullif(current_setting('test.auth_role', true), '')) $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='org_owner') THEN CREATE ROLE org_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, org_owner;
GRANT CREATE ON SCHEMA public TO org_owner;

SET ROLE org_owner;
\ir helpers/organizations_businesses_live_20261019.sql
CREATE TABLE public.business_ownership (id uuid, business_id uuid, owner_id uuid, status text);
CREATE TABLE public.organization_contributors (id uuid, organization_id uuid, user_id uuid, role text, status text);
CREATE TABLE public.organization_ownership_verifications (id uuid, organization_id uuid, user_id uuid, status text);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
-- The live policies (pg_policies, 2026-10-19).
CREATE POLICY "Anyone views public orgs" ON public.organizations FOR SELECT USING (is_public = true);
CREATE POLICY "Business owners can view their businesses" ON public.organizations FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.business_ownership WHERE business_ownership.business_id = organizations.id
    AND business_ownership.owner_id = (SELECT auth.uid()) AND business_ownership.status = 'active'));
CREATE POLICY "Business owners can update their businesses" ON public.organizations FOR UPDATE USING (EXISTS (
  SELECT 1 FROM public.business_ownership WHERE business_ownership.business_id = organizations.id
    AND business_ownership.owner_id = (SELECT auth.uid()) AND business_ownership.status = 'active'));
CREATE POLICY "Discoverers can update their businesses" ON public.organizations FOR UPDATE
  USING (discovered_by = (SELECT auth.uid()) OR uploaded_by = (SELECT auth.uid()));
CREATE POLICY "Owners/contributors update orgs" ON public.organizations FOR UPDATE USING (
  (SELECT auth.uid()) = discovered_by
  OR EXISTS (SELECT 1 FROM public.organization_contributors oc WHERE oc.organization_id = organizations.id
    AND oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'
    AND oc.role = ANY (ARRAY['owner', 'co_founder', 'board_member', 'manager']))
  OR EXISTS (SELECT 1 FROM public.organization_ownership_verifications oov WHERE oov.organization_id = organizations.id
    AND oov.user_id = (SELECT auth.uid()) AND oov.status = 'approved'));
-- The live relacl of each relation (2026-10-19).
GRANT SELECT, REFERENCES, TRIGGER ON public.organizations TO anon;
GRANT SELECT, INSERT, UPDATE, REFERENCES, TRIGGER ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.businesses TO anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER ON public.business_ownership TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_contributors, public.organization_ownership_verifications
  TO anon, authenticated;
GRANT ALL ON public.business_ownership, public.organization_contributors, public.organization_ownership_verifications
  TO service_role;

-- Org 1 is public with private fields; org 2 is private. Users: 1 stranger, 2 discoverer, 3 business owner,
-- 4 manager contributor, 5 viewer contributor, 6 approved verification, 7 pending verification.
INSERT INTO public.organizations (id, business_name, email, phone, city, is_public, tax_id, business_license,
  registration_state, discovered_by)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'Public Shop', 'shop@fixture.invalid', 'synthetic-phone', 'Reno', true,
        'synthetic-tax-id', 'synthetic-license', 'NV', '00000000-0000-0000-0000-000000000002'),
       ('00000000-0000-0000-0000-0000000000a2', 'Private Shop', NULL, NULL, 'Elko', false,
        'private-tax-id', NULL, NULL, NULL);
INSERT INTO public.business_ownership VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', 'active');
INSERT INTO public.organization_contributors VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000004', 'manager', 'active'),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000005', 'viewer', 'active');
INSERT INTO public.organization_ownership_verifications VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000006', 'approved'),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000007', 'pending');
RESET ROLE;

-- 0. The live grant state exposes tax_id on a public row to anon, directly and through businesses.
SET ROLE anon;
DO $$ BEGIN
  IF (SELECT tax_id FROM public.organizations WHERE business_name = 'Public Shop') IS DISTINCT FROM 'synthetic-tax-id'
     OR (SELECT tax_id FROM public.businesses WHERE business_name = 'Public Shop') IS DISTINCT FROM 'synthetic-tax-id' THEN
    RAISE EXCEPTION 'Fixture did not reproduce the tax_id exposure';
  END IF;
END $$;
RESET ROLE;

SET ROLE org_owner;
\ir ../migrations/20261020140000_organization_private_fields_read.sql
RESET ROLE;

-- 1. Grants: authenticated and the service role may call the reader; anon and PUBLIC may not.
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.organization_private_fields_read(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.organization_private_fields_read(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.organization_private_fields_read(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'organization_private_fields_read execute grants are wrong';
  END IF;
END $$;
SET ROLE anon;
DO $$ BEGIN
  PERFORM public.organization_private_fields_read('00000000-0000-0000-0000-0000000000a1');
  RAISE EXCEPTION 'anon called the private reader';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

-- 2. Signed-in callers: each editor path reads both fields; strangers, non-editor contributors, pending
-- verifications and a missing identity are refused.
CREATE FUNCTION pg_temp.private_read_as(p_user text, p_org uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('test.auth_uid', p_user, false);
  PERFORM set_config('test.auth_role', 'authenticated', false);
  BEGIN
    v := public.organization_private_fields_read(p_org);
  EXCEPTION WHEN insufficient_privilege THEN v := '"refused"'::jsonb;
  END;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.private_read_as(text, uuid) TO authenticated;
SET ROLE authenticated;
DO $$
DECLARE
  v_editor text;
  v_refused text;
BEGIN
  FOREACH v_editor IN ARRAY ARRAY['00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000006'] LOOP
    IF pg_temp.private_read_as(v_editor, '00000000-0000-0000-0000-0000000000a1')
       IS DISTINCT FROM '{"tax_id": "synthetic-tax-id", "business_license": "synthetic-license"}'::jsonb THEN
      RAISE EXCEPTION 'Editor % lost the private fields', v_editor;
    END IF;
  END LOOP;
  FOREACH v_refused IN ARRAY ARRAY['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000007', ''] LOOP
    IF pg_temp.private_read_as(v_refused, '00000000-0000-0000-0000-0000000000a1') IS DISTINCT FROM '"refused"'::jsonb THEN
      RAISE EXCEPTION 'Caller "%" read private fields without editing rights', v_refused;
    END IF;
  END LOOP;
  IF pg_temp.private_read_as('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2')
     IS DISTINCT FROM '"refused"'::jsonb THEN
    RAISE EXCEPTION 'An editor of one organization read another organization''s private fields';
  END IF;
END $$;
RESET ROLE;

-- 3. The trusted service role reads any organization.
SET ROLE service_role;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'service_role', false);
DO $$ BEGIN
  IF public.organization_private_fields_read('00000000-0000-0000-0000-0000000000a2') ->> 'tax_id' <> 'private-tax-id' THEN
    RAISE EXCEPTION 'Service role lost the private reader';
  END IF;
END $$;
RESET ROLE;

SET ROLE org_owner;
\ir ../migrations/20261020141000_organizations_private_columns.sql
RESET ROLE;

-- 4. Grants: the two private columns and the table-wide SELECT are gone for anon and authenticated; every
-- other column stays readable; the service role keeps everything.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(r, 'public.organizations', 'SELECT')
       OR has_column_privilege(r, 'public.organizations', 'tax_id', 'SELECT')
       OR has_column_privilege(r, 'public.organizations', 'business_license', 'SELECT') THEN
      RAISE EXCEPTION '% can still read a private organizations column', r;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.organizations'::regclass AND attnum > 0
                 AND NOT attisdropped AND attname NOT IN ('tax_id', 'business_license')
                 AND NOT has_column_privilege(r, 'public.organizations', attname, 'SELECT')) THEN
      RAISE EXCEPTION '% lost a public organizations column', r;
    END IF;
  END LOOP;
  IF NOT has_column_privilege('service_role', 'public.organizations', 'tax_id', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.organizations', 'UPDATE') THEN
    RAISE EXCEPTION 'Service read or editor write privileges changed';
  END IF;
  IF (SELECT reloptions FROM pg_class WHERE oid = 'public.businesses'::regclass) IS DISTINCT FROM ARRAY['security_invoker=true'] THEN
    RAISE EXCEPTION 'businesses stopped running as its caller';
  END IF;
END $$;

-- 5. anon: explicit public columns and row policies unchanged; wildcard and private columns refused on the
-- table; businesses keeps its full shape with NULL private fields.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'anon', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.organizations) <> 1
     OR (SELECT email FROM public.organizations WHERE business_name = 'Public Shop') <> 'shop@fixture.invalid'
     OR (SELECT registration_state FROM public.organizations WHERE business_name = 'Public Shop') <> 'NV' THEN
    RAISE EXCEPTION 'anon lost public columns or row eligibility changed';
  END IF;
  BEGIN
    PERFORM tax_id FROM public.organizations;
    RAISE EXCEPTION 'anon read organizations.tax_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM business_license FROM public.organizations;
    RAISE EXCEPTION 'anon read organizations.business_license';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM o.* FROM public.organizations o;
    RAISE EXCEPTION 'anon wildcard on organizations still expands to private columns';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.businesses) <> 1
     OR (SELECT to_jsonb(b) ->> 'business_name' FROM public.businesses b) <> 'Public Shop'
     OR (SELECT to_jsonb(b) ->> 'tax_id' FROM public.businesses b) IS NOT NULL
     OR (SELECT to_jsonb(b) ->> 'business_license' FROM public.businesses b) IS NOT NULL THEN
    RAISE EXCEPTION 'businesses wildcard read broke or still returns private fields';
  END IF;
END $$;
RESET ROLE;

-- 6. A signed-in editor: the reader still works, updates of the private fields go through organizations
-- without RETURNING them, and the view refuses writes to its NULL columns while other columns stay writable.
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-000000000003', false),
       set_config('test.auth_role', 'authenticated', false);
UPDATE public.organizations SET tax_id = 'updated-tax-id'
WHERE id = '00000000-0000-0000-0000-0000000000a1' RETURNING business_name;
UPDATE public.businesses SET city = 'Sparks' WHERE id = '00000000-0000-0000-0000-0000000000a1';
DO $$ BEGIN
  IF public.organization_private_fields_read('00000000-0000-0000-0000-0000000000a1') ->> 'tax_id' <> 'updated-tax-id'
     OR (SELECT city FROM public.organizations WHERE id = '00000000-0000-0000-0000-0000000000a1') <> 'Sparks' THEN
    RAISE EXCEPTION 'Editor update or private read broke';
  END IF;
  BEGIN
    UPDATE public.businesses SET tax_id = 'via-view' WHERE id = '00000000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'businesses accepted a write to its NULL tax_id column';
  EXCEPTION WHEN feature_not_supported THEN NULL;
  END;
  BEGIN
    PERFORM tax_id FROM public.organizations WHERE id = '00000000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'Editor read tax_id through the table instead of the reader';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- 7. New columns are private by default; the service role still reads the table with a wildcard.
ALTER TABLE public.organizations ADD COLUMN future_private_field text;
DO $$ BEGIN
  IF has_column_privilege('anon', 'public.organizations', 'future_private_field', 'SELECT')
     OR has_column_privilege('authenticated', 'public.organizations', 'future_private_field', 'SELECT') THEN
    RAISE EXCEPTION 'A new organizations column inherited public read access';
  END IF;
END $$;
SET ROLE service_role;
DO $$ BEGIN
  IF (SELECT tax_id FROM (SELECT o.* FROM public.organizations o WHERE o.id = '00000000-0000-0000-0000-0000000000a1') s)
     <> 'updated-tax-id' THEN
    RAISE EXCEPTION 'Service role lost the table';
  END IF;
END $$;
RESET ROLE;

SELECT 'PASS: exposure reproduced; tax_id/business_license editor-only via reader; public columns, businesses wildcard, editor writes and service access intact; new columns private' AS result;
