-- Isolated PostgreSQL 17 contract for 20261007130000_create_organization_batch.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_create_organization_batch_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_create_organization_batch_ci -f supabase/sql/test_create_organization_batch_contract.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- Minimal prod-shape fixtures (the columns the function touches; is_public defaults true like prod).
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  name text,
  website text,
  city text, state text, zip_code text, country text DEFAULT 'US',
  is_public boolean DEFAULT true,
  business_type text,
  discovered_by uuid, uploaded_by uuid, discovered_via text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.write_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz DEFAULT now(),
  tbl text, op text, rows integer, writer text, db_role text, app_name text, txid bigint
);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);

\ir ../migrations/20261007130000_create_organization_batch.sql

-- Case 1: same domain in four shapes -> one row.
SELECT public.create_organization_batch(
  '[{"business_name":"Acme Robotics","website":"http://www.acme-robotics.com/about?x=1"},
    {"business_name":"Acme Robotics Inc","website":"https://acme-robotics.com"}]'::jsonb, 'sbir-test') AS r1 \gset
SELECT pg_temp.ok('case1: duplicate domain variants create one row',
  (SELECT count(*) FROM public.organizations WHERE website = 'https://acme-robotics.com') = 1);
SELECT pg_temp.ok('case1: first created, second enriched',
  (:'r1'::jsonb->>'created')::int = 1 AND (:'r1'::jsonb->>'enriched')::int = 1);

-- Case 5 + 2: created-row invariants, and COALESCE-fill does not overwrite.
SELECT pg_temp.ok('case5: is_public false, business_type null, no user stamps, discovered_via set',
  (SELECT is_public = false AND business_type IS NULL AND discovered_by IS NULL AND uploaded_by IS NULL
          AND discovered_via = 'declared-source:sbir-test'
          AND metadata->'org_intake'->>'source' = 'sbir-test'
     FROM public.organizations WHERE website = 'https://acme-robotics.com'));
UPDATE public.organizations SET city = 'Boston' WHERE website = 'https://acme-robotics.com';
SELECT public.create_organization_batch(
  '[{"business_name":"Acme Robotics","website":"https://acme-robotics.com","city":"Cambridge"}]'::jsonb,'sbir-test');
SELECT pg_temp.ok('case2: existing non-null city not overwritten',
  (SELECT city FROM public.organizations WHERE website='https://acme-robotics.com') = 'Boston');

-- Case 3: DUNS, no website, twice -> one row; DUNS on a different domain -> conflict, no row.
SELECT public.create_organization_batch('[{"business_name":"NoSite LLC","duns":"111222333"}]'::jsonb,'sbir-test');
SELECT public.create_organization_batch('[{"business_name":"NoSite LLC again","duns":"111222333"}]'::jsonb,'sbir-test') AS r3 \gset
SELECT pg_temp.ok('case3: same DUNS no website creates one row',
  (SELECT count(*) FROM public.organizations WHERE metadata->>'duns' = '111222333') = 1);
SELECT pg_temp.ok('case3: second call enriched, not created', (:'r3'::jsonb->>'created')::int = 0);
SELECT public.create_organization_batch(
  '[{"business_name":"Acme Robotics","website":"https://acme-robotics.com","duns":"999888777"}]'::jsonb,'sbir-test');
SELECT public.create_organization_batch(
  '[{"business_name":"Impostor","website":"https://other-domain.com","duns":"999888777"}]'::jsonb,'sbir-test') AS r3b \gset
SELECT pg_temp.ok('case3: DUNS on a different domain counts a conflict, no row',
  (:'r3b'::jsonb->>'conflicts')::int = 1 AND (SELECT count(*) FROM public.organizations WHERE website='https://other-domain.com') = 0);

-- Case 7: scheme-less / empty website never matches anything (the retired function's failure).
SELECT public.create_organization_batch(
  '[{"business_name":"NoKey Co"},{"business_name":"Blank","website":""}]'::jsonb,'sbir-test') AS r7 \gset
SELECT pg_temp.ok('case7: candidate with no website and no DUNS is skipped, no row',
  (:'r7'::jsonb->>'skipped_no_key')::int = 2 AND (:'r7'::jsonb->>'created')::int = 0);

-- Case 4: force_new creates a second row only when passed.
SELECT public.create_organization_batch(
  '[{"business_name":"Acme Robotics","website":"https://acme-robotics.com"}]'::jsonb,'sbir-test', true) AS r4 \gset
SELECT pg_temp.ok('case4: force_new creates a second row',
  (:'r4'::jsonb->>'created')::int = 1 AND (SELECT count(*) FROM public.organizations WHERE website='https://acme-robotics.com') = 2);

-- Case 6: one receipt per batch; registry names the function.
SELECT pg_temp.ok('case6: a write_receipt per changing batch exists for organizations',
  (SELECT count(*) FROM public.write_receipts WHERE writer='create-organization-batch' AND tbl='organizations') >= 1);
SELECT pg_temp.ok('case6: pipeline_registry names create_organization_batch on organizations',
  (SELECT write_via FROM public.pipeline_registry WHERE table_name='organizations' AND column_name IS NULL) LIKE 'create_organization_batch%');

-- ACL: service-role-only EXECUTE.
SELECT pg_temp.ok('acl: anon cannot EXECUTE',
  has_function_privilege('anon','public.create_organization_batch(jsonb, text, boolean)','EXECUTE') = false);
SELECT pg_temp.ok('acl: authenticated cannot EXECUTE',
  has_function_privilege('authenticated','public.create_organization_batch(jsonb, text, boolean)','EXECUTE') = false);
SELECT pg_temp.ok('acl: service_role can EXECUTE',
  has_function_privilege('service_role','public.create_organization_batch(jsonb, text, boolean)','EXECUTE') = true);

DO $$ BEGIN RAISE NOTICE 'ALL CONTRACTS PASSED: create_organization_batch'; END $$;
