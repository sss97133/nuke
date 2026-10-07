-- Isolated PostgreSQL 17 contract for 20261008067000_extraction_metadata_write_policy_service_role.sql. Synthetic rows only.
--   createdb dm_refinement_extraction_metadata_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_extraction_metadata_ci -f supabase/sql/test_extraction_metadata_write_policy.sql
-- Fixtures: a minimal extraction_metadata with RLS on, the live grants and the two live policies, and a fixture copy of the
-- 20261008064000 describe clause that records the open door.
-- Covered: before, anon inserts and deletes rows; after, anon and authenticated cannot insert, and their updates and deletes
-- change no row, while both still read every row; service_role still inserts, updates and deletes; the clause is rewritten in
-- place with the rest of the comment kept; re-apply changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.extraction_metadata') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.extraction_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text, field_value text,
  extraction_method text, confidence_score numeric, created_at timestamptz DEFAULT now());
ALTER TABLE public.extraction_metadata ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.extraction_metadata TO anon, authenticated, service_role;
CREATE POLICY "Anyone can view extraction metadata" ON public.extraction_metadata FOR SELECT USING (true);
CREATE POLICY "Service role can manage extraction metadata" ON public.extraction_metadata FOR ALL USING (true) WITH CHECK (true);
COMMENT ON TABLE public.extraction_metadata IS
'Provenance of each extraction (fixture copy of the 20261008064000 describe). Access: RLS is on, but the policy named Service role can manage extraction metadata is FOR ALL to every role with USING (true) and WITH CHECK (true), and anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE, so any caller with the public API key can insert, change or delete any row; anon reads every row. Clocks: created_at is the insert time.';

INSERT INTO public.extraction_metadata (field_name, field_value, extraction_method) VALUES
  ('year', '1972', 'regex'), ('make', 'Porsche', 'regex'), ('model', '911', 'regex');

SET ROLE anon;
INSERT INTO public.extraction_metadata (field_name, field_value, extraction_method) VALUES ('color', 'red', 'anon-write');
DO $$ DECLARE n int; BEGIN
  DELETE FROM public.extraction_metadata WHERE field_name = 'color';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.ok('fixture reproduces the exposure: anon inserts and deletes a row', n = 1);
END $$;
RESET ROLE;

\ir ../migrations/20261008067000_extraction_metadata_write_policy_service_role.sql

SELECT pg_temp.ok('the write policy applies to service_role only, the read policy is unchanged',
  (SELECT roles::text FROM pg_policies WHERE tablename = 'extraction_metadata' AND policyname = 'Service role can manage extraction metadata') = '{service_role}'
  AND (SELECT roles::text || cmd || qual FROM pg_policies WHERE tablename = 'extraction_metadata' AND policyname = 'Anyone can view extraction metadata') = '{public}SELECTtrue');

SET ROLE anon;
DO $$ BEGIN
  INSERT INTO public.extraction_metadata (field_name, field_value, extraction_method) VALUES ('color', 'blue', 'anon-write');
  RAISE EXCEPTION 'Contract failed: anon still inserts after the migration';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS anon insert refused by row security';
END $$;
DO $$ DECLARE u int; d int; BEGIN
  UPDATE public.extraction_metadata SET field_value = 'tampered';
  GET DIAGNOSTICS u = ROW_COUNT;
  DELETE FROM public.extraction_metadata;
  GET DIAGNOSTICS d = ROW_COUNT;
  PERFORM pg_temp.ok('anon updates and deletes change no row', u = 0 AND d = 0);
END $$;
SELECT pg_temp.ok('anon still reads every row', (SELECT count(*) FROM public.extraction_metadata) = 3);
RESET ROLE;

SET ROLE authenticated;
DO $$ BEGIN
  INSERT INTO public.extraction_metadata (field_name, field_value, extraction_method) VALUES ('color', 'green', 'user-write');
  RAISE EXCEPTION 'Contract failed: a signed-in account still inserts after the migration';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS signed-in insert refused by row security';
END $$;
DO $$ DECLARE d int; BEGIN
  DELETE FROM public.extraction_metadata;
  GET DIAGNOSTICS d = ROW_COUNT;
  PERFORM pg_temp.ok('a signed-in delete changes no row, and the account still reads', d = 0 AND (SELECT count(*) FROM public.extraction_metadata) = 3);
END $$;
RESET ROLE;

SET ROLE service_role;
INSERT INTO public.extraction_metadata (field_name, field_value, extraction_method) VALUES ('trim', 'S', 'extract-bat-core');
DO $$ DECLARE u int; d int; BEGIN
  UPDATE public.extraction_metadata SET confidence_score = 0.9 WHERE field_name = 'trim';
  GET DIAGNOSTICS u = ROW_COUNT;
  DELETE FROM public.extraction_metadata WHERE field_name = 'trim';
  GET DIAGNOSTICS d = ROW_COUNT;
  PERFORM pg_temp.ok('service_role still inserts, updates and deletes', u = 1 AND d = 1);
END $$;
RESET ROLE;

SELECT pg_temp.ok('no fixture row was changed by the refused writes',
  (SELECT count(*) FROM public.extraction_metadata WHERE field_value = 'tampered' OR extraction_method IN ('anon-write', 'user-write')) = 0
  AND (SELECT count(*) FROM public.extraction_metadata) = 3);
SELECT pg_temp.ok('the describe clause was rewritten in place and the rest of the comment kept',
  obj_description('public.extraction_metadata'::regclass, 'pg_class') LIKE '%was FOR ALL to every role with USING (true) and WITH CHECK (true) until 2026-10-07%since 20261008067000 it applies to service_role only%'
  AND obj_description('public.extraction_metadata'::regclass, 'pg_class') NOT LIKE '%so any caller with the public API key can insert%'
  AND obj_description('public.extraction_metadata'::regclass, 'pg_class') LIKE 'Provenance of each extraction%'
  AND obj_description('public.extraction_metadata'::regclass, 'pg_class') LIKE '%anon reads every row. Clocks: created_at is the insert time.');

\ir ../migrations/20261008067000_extraction_metadata_write_policy_service_role.sql
SELECT pg_temp.ok('re-apply changes nothing',
  (SELECT count(*) FROM pg_policies WHERE tablename = 'extraction_metadata') = 2
  AND (length(obj_description('public.extraction_metadata'::regclass, 'pg_class'))
       - length(replace(obj_description('public.extraction_metadata'::regclass, 'pg_class'), 'since 20261008067000', ''))) / length('since 20261008067000') = 1);
\echo 'extraction_metadata write policy contract: all checks passed'
