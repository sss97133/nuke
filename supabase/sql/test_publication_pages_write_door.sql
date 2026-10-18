-- Isolated PostgreSQL 17 contract for 20261008014000_publication_pages_write_door.sql. Synthetic rows only.
--   createdb dm_refinement_pub_pages_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_pub_pages_ci -f supabase/sql/test_publication_pages_write_door.sql
-- Fixtures: publication_pages with RLS and the three live policies as prod carried them (every role), the three mag_*
-- functions as stand-ins that update spatial_tags (SECURITY INVOKER), the API roles with Supabase's default grants.
-- Covered: the fixture reproduces the exposure; after the migration anon cannot insert or update, still reads; service_role
-- still writes; the three functions are service_role only; a re-apply changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.publication_pages') IS NOT NULL THEN
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
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.fails(label text, stmt text, want_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    got := SQLSTATE;
    IF got <> want_state THEN RAISE EXCEPTION 'Contract failed: % raised % (%), wanted %', label, got, SQLERRM, want_state; END IF;
    RAISE NOTICE 'PASS % (refused %)', label, got; RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % was admitted', label;
END $$;

CREATE TABLE public.publication_pages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), page_number integer, spatial_tags jsonb DEFAULT '[]'::jsonb, created_at timestamptz DEFAULT now());
ALTER TABLE public.publication_pages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.publication_pages TO anon, authenticated, service_role;
CREATE POLICY pub_pages_read ON public.publication_pages FOR SELECT USING (true);
CREATE POLICY pub_pages_insert ON public.publication_pages FOR INSERT WITH CHECK (true);
CREATE POLICY pub_pages_update ON public.publication_pages FOR UPDATE USING (true);
INSERT INTO public.publication_pages (id, page_number, spatial_tags) VALUES ('00000000-0000-0000-0000-0000000000a1', 1, '[{"brand": "x"}]');
CREATE FUNCTION public.mag_remediate_coverstar_text() RETURNS integer LANGUAGE sql AS $$ UPDATE public.publication_pages SET spatial_tags = '[]'::jsonb RETURNING 1 $$;
CREATE FUNCTION public.mag_flag_caption_echoes() RETURNS integer LANGUAGE sql AS $$ UPDATE public.publication_pages SET spatial_tags = '[]'::jsonb RETURNING 1 $$;
CREATE FUNCTION public.mag_unland_brand_evidence() RETURNS integer LANGUAGE sql AS $$ UPDATE public.publication_pages SET spatial_tags = '[]'::jsonb RETURNING 1 $$;

SET ROLE anon;
INSERT INTO public.publication_pages (page_number) VALUES (2);
UPDATE public.publication_pages SET page_number = 99 WHERE id = '00000000-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT pg_temp.ok('fixture reproduces the exposure: anon inserted a page and overwrote another before the migration',
  (SELECT count(*) FROM public.publication_pages) = 2 AND (SELECT page_number FROM public.publication_pages WHERE id = '00000000-0000-0000-0000-0000000000a1') = 99);

\ir ../migrations/20261008014000_publication_pages_write_door.sql

SELECT pg_temp.ok('the insert and update policies apply to service_role only; the read policy stays public',
  (SELECT bool_and(roles = ARRAY['service_role']::name[]) FROM pg_policies WHERE tablename = 'publication_pages' AND policyname IN ('pub_pages_insert', 'pub_pages_update'))
  AND (SELECT roles = ARRAY['public']::name[] FROM pg_policies WHERE tablename = 'publication_pages' AND policyname = 'pub_pages_read'));
SET ROLE anon;
SELECT pg_temp.ok('anon still reads every page', (SELECT count(*) FROM public.publication_pages) = 2);
SELECT pg_temp.fails('anon can no longer insert a page', $q$INSERT INTO public.publication_pages (page_number) VALUES (3)$q$, '42501');
UPDATE public.publication_pages SET page_number = 7 WHERE id = '00000000-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT pg_temp.ok('an anon UPDATE under RLS changes nothing', (SELECT page_number FROM public.publication_pages WHERE id = '00000000-0000-0000-0000-0000000000a1') = 99);
SELECT pg_temp.ok('the three rewrite functions are service_role only',
  NOT has_function_privilege('anon', 'public.mag_remediate_coverstar_text()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.mag_flag_caption_echoes()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.mag_unland_brand_evidence()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.mag_unland_brand_evidence()', 'EXECUTE'));
SET ROLE service_role;
UPDATE public.publication_pages SET page_number = 1 WHERE id = '00000000-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT pg_temp.ok('service_role still writes (the scripts'' path)', (SELECT page_number FROM public.publication_pages WHERE id = '00000000-0000-0000-0000-0000000000a1') = 1);
\ir ../migrations/20261008014000_publication_pages_write_door.sql
SELECT pg_temp.ok('re-apply changes nothing', (SELECT count(*) FROM pg_policies WHERE tablename = 'publication_pages') = 3);
\echo 'publication_pages write door contract: all checks passed'
