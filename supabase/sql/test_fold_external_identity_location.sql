-- Isolated PostgreSQL 17 contract for 20261007070000_fold_external_identity_location.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_fold_external_identity_location_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_fold_external_identity_location_ci -f supabase/sql/test_fold_external_identity_location.sql
-- Fixture: the minimal shape of the tables the fold touches (external_identities, vehicle_observations,
-- pipeline_registry, write_receipts). The migration is applied as shipped (\ir), twice (it is idempotent:
-- CREATE OR REPLACE + pipeline_registry ON CONFLICT).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.external_identities') IS NOT NULL THEN
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

-- The three Supabase API roles must exist before the migration applies, so its REVOKE/GRANT block runs and the
-- ACL assertions below can read real grants. A freshly CREATEd function gets EXECUTE for PUBLIC by default (the
-- anonymous write door); the migration must take it away.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE public.external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL, handle text NOT NULL, metadata jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text, subject_id uuid, is_superseded boolean DEFAULT false,
  kind text, structured_data jsonb, observed_at timestamptz
);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);
CREATE TABLE public.write_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz DEFAULT now(),
  tbl text, op text, rows integer, writer text, db_role text, app_name text, txid bigint
);

\ir ../migrations/20261007070000_fold_external_identity_location.sql
\ir ../migrations/20261007100000_fold_location_source_passthrough.sql

-- Fixture: one identity with a pre-existing metadata key, and two observations (an older superseded one and
-- the current one). A second identity whose observation carries a city must NOT get a city written.
INSERT INTO public.external_identities (id, platform, handle, metadata) VALUES
  ('11111111-1111-1111-1111-111111111111', 'bat', 'TestMember', '{"comment_count": 42}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'bat', 'CityMember', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'bat', 'CommentMember', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'bat', 'NoSourceMember', '{}'::jsonb);
INSERT INTO public.vehicle_observations (subject_type, subject_id, is_superseded, kind, structured_data, observed_at) VALUES
  ('external_identity', '11111111-1111-1111-1111-111111111111', true,  'specification',
   '{"home_state":"CA","home_country":"USA","grain":"state_country","source":"bat_member_page"}'::jsonb, '2026-01-01T00:00:00Z'),
  ('external_identity', '11111111-1111-1111-1111-111111111111', false, 'specification',
   '{"home_state":"IL","home_country":"USA","grain":"state_country","source":"bat_member_page"}'::jsonb, '2026-10-07T00:00:00Z'),
  ('external_identity', '22222222-2222-2222-2222-222222222222', false, 'specification',
   '{"home_state":"NV","home_country":"USA","city":"Las Vegas","source":"bat_member_page"}'::jsonb, '2026-10-07T00:00:00Z'),
  -- source passthrough: a comment-sourced location keeps source bat_comment; a source-less one falls back to bat.
  ('external_identity', '33333333-3333-3333-3333-333333333333', false, 'specification',
   '{"home_state":"TX","home_country":"USA","source":"bat_comment"}'::jsonb, '2026-10-07T00:00:00Z'),
  ('external_identity', '44444444-4444-4444-4444-444444444444', false, 'specification',
   '{"home_state":"OR","home_country":"USA"}'::jsonb, '2026-10-07T00:00:00Z');

-- First fold.
SELECT public.fold_external_identity_location(100) AS r1 \gset
SELECT pg_temp.ok('first fold reports folded=4', (:'r1'::jsonb ->> 'folded')::int = 4);

SELECT metadata AS m1 FROM public.external_identities WHERE handle = 'TestMember' \gset
SELECT pg_temp.ok('latest (non-superseded) state wins: IL',          (:'m1'::jsonb ->> 'state') = 'IL');
SELECT pg_temp.ok('country folded: USA',                              (:'m1'::jsonb ->> 'country') = 'USA');
SELECT pg_temp.ok('pre-existing metadata key preserved (merge)',      (:'m1'::jsonb ->> 'comment_count') = '42');
SELECT pg_temp.ok('location_source stamped',                          (:'m1'::jsonb ->> 'location_source') = 'bat_member_page');
SELECT pg_temp.ok('no city written even when present (not this key)', NOT (:'m1'::jsonb ? 'city'));

SELECT metadata AS m2 FROM public.external_identities WHERE handle = 'CityMember' \gset
SELECT pg_temp.ok('masking: city never written for the city observation', NOT (:'m2'::jsonb ? 'city'));
SELECT pg_temp.ok('state still folded for CityMember: NV',               (:'m2'::jsonb ->> 'state') = 'NV');

-- Source passthrough: the observation's own source is carried to metadata.location_source (fallback 'bat').
SELECT metadata AS m3 FROM public.external_identities WHERE handle = 'CommentMember' \gset
SELECT pg_temp.ok('comment-sourced location_source carried: bat_comment', (:'m3'::jsonb ->> 'location_source') = 'bat_comment');
SELECT pg_temp.ok('comment-sourced state folded: TX',                      (:'m3'::jsonb ->> 'state') = 'TX');
SELECT metadata AS m4 FROM public.external_identities WHERE handle = 'NoSourceMember' \gset
SELECT pg_temp.ok('source-less location_source falls back to bat',         (:'m4'::jsonb ->> 'location_source') = 'bat');

-- Idempotency: a second fold changes nothing.
SELECT public.fold_external_identity_location(100) AS r2 \gset
SELECT pg_temp.ok('second fold is idempotent (folded=0)', (:'r2'::jsonb ->> 'folded')::int = 0);

-- One write_receipt from the first fold only.
SELECT pg_temp.ok('exactly one write_receipt for the one changing call',
  (SELECT count(*) FROM public.write_receipts WHERE writer = 'fold-external-identity-location' AND rows = 4) = 1);

-- app.writer restored to empty (no caller set one in this script).
SELECT pg_temp.ok('app.writer restored after the call', coalesce(current_setting('app.writer', true), '') = '');

-- ACL: SECURITY DEFINER write function must be service_role-only (no anonymous write door, case 10).
SELECT pg_temp.ok('ACL: anon cannot EXECUTE the fold',
  has_function_privilege('anon', 'public.fold_external_identity_location(integer)', 'EXECUTE') = false);
SELECT pg_temp.ok('ACL: authenticated cannot EXECUTE the fold',
  has_function_privilege('authenticated', 'public.fold_external_identity_location(integer)', 'EXECUTE') = false);
SELECT pg_temp.ok('ACL: service_role can EXECUTE the fold',
  has_function_privilege('service_role', 'public.fold_external_identity_location(integer)', 'EXECUTE') = true);

DO $$ BEGIN RAISE NOTICE 'ALL CONTRACTS PASSED: fold_external_identity_location'; END $$;
