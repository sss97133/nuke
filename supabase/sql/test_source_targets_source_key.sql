-- Isolated PostgreSQL 17 contract for 20261013084500_key_source_targets_source_slug.sql. Synthetic rows only; never
-- production.
-- Run in an empty, disposable dm_refinement_* database:
--   createdb dm_refinement_source_targets_key_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_source_targets_key_ci -f supabase/sql/test_source_targets_source_key.sql
-- Fixtures carry the live columns of source_targets (prod, 2026-10-13; id is GENERATED ALWAYS AS IDENTITY, no
-- triggers) and the columns of observation_sources the key needs (slug UNIQUE; category is an enum on prod, text here).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.source_targets') IS NOT NULL THEN
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
-- A statement must be refused with foreign_key_violation.
CREATE FUNCTION pg_temp.refused(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS % (refused: %)', label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % was admitted', label;
END $$;

-- Live shapes ------------------------------------------------------------------------------------------------------------
CREATE TABLE public.observation_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL CONSTRAINT observation_sources_slug_key UNIQUE,
  display_name text NOT NULL,
  category text NOT NULL);
CREATE TABLE public.source_targets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_slug text NOT NULL,
  listing_url text NOT NULL CONSTRAINT source_targets_url_unique UNIQUE,
  sitemap_file text,
  first_discovered_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now());
CREATE INDEX idx_source_targets_slug ON public.source_targets (source_slug);

-- Before the migration: two registered sources, each with discovered targets ------------------------------------------
INSERT INTO public.observation_sources (slug, display_name, category) VALUES
  ('mecum', 'Mecum', 'auction'), ('gooding', 'Gooding', 'auction'), ('autohunter', 'AutoHunter', 'auction');
INSERT INTO public.source_targets (source_slug, listing_url, sitemap_file) VALUES
  ('mecum', 'https://example.test/mecum/lot/1', 'lot-sitemap'),
  ('mecum', 'https://example.test/mecum/lot/2', 'lot-sitemap'),
  ('gooding', 'https://example.test/gooding/lot/1', 'sitemap.xml');

\ir ../migrations/20261013084500_key_source_targets_source_slug.sql

-- The key ---------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('one foreign key from source_targets, source_slug to observation_sources(slug)',
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.source_targets'::regclass AND contype = 'f') = 1
  AND EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conname = 'source_targets_source_slug_fkey'
                AND c.conrelid = 'public.source_targets'::regclass
                AND c.confrelid = 'public.observation_sources'::regclass
                AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.source_targets'::regclass AND attname = 'source_slug')]
                AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.observation_sources'::regclass AND attname = 'slug')]));
SELECT pg_temp.ok('the key is validated and NO ACTION on delete and update',
  (SELECT convalidated AND confdeltype = 'a' AND confupdtype = 'a' FROM pg_constraint WHERE conname = 'source_targets_source_slug_fkey'));
SELECT pg_temp.ok('the constraint and the column carry their comments',
  obj_description((SELECT oid FROM pg_constraint WHERE conname = 'source_targets_source_slug_fkey'), 'pg_constraint') LIKE 'The source whose sitemap or search listed the URL%'
  AND col_description('public.source_targets'::regclass,
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.source_targets'::regclass AND attname = 'source_slug')) LIKE 'The source whose sitemap or search API listed the URL%');

-- Rows ------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the migration wrote no row: all three targets kept unchanged',
  (SELECT count(*) FROM public.source_targets) = 3
  AND (SELECT count(*) FROM public.source_targets WHERE source_slug = 'mecum') = 2);

-- The writer's statement (scripts/ingest-source-targets.sh bulk_load) for a registered slug is admitted, and its
-- conflict path (a URL seen again) still refreshes last_seen_at.
INSERT INTO public.source_targets (source_slug, listing_url, sitemap_file) VALUES
  ('autohunter', 'https://example.test/autohunter/1', 'classic-com-index'),
  ('mecum', 'https://example.test/mecum/lot/1', 'lot-sitemap')
ON CONFLICT (listing_url) DO UPDATE SET last_seen_at = now() + interval '1 day';
SELECT pg_temp.ok('a target for a registered source is admitted and a repeat URL refreshes last_seen_at',
  (SELECT count(*) FROM public.source_targets) = 4
  AND (SELECT last_seen_at > first_discovered_at FROM public.source_targets WHERE listing_url = 'https://example.test/mecum/lot/1'));

SELECT pg_temp.refused('a target for a slug the registry does not hold',
  $$INSERT INTO public.source_targets (source_slug, listing_url, sitemap_file)
    VALUES ('not-a-source', 'https://example.test/x/1', 'sitemap.xml')$$);
SELECT pg_temp.refused('re-keying a target to an unregistered slug',
  $$UPDATE public.source_targets SET source_slug = 'not-a-source' WHERE listing_url = 'https://example.test/gooding/lot/1'$$);
SELECT pg_temp.refused('deleting a source that still has targets',
  $$DELETE FROM public.observation_sources WHERE slug = 'gooding'$$);
SELECT pg_temp.refused('renaming the slug of a source that still has targets',
  $$UPDATE public.observation_sources SET slug = 'gooding-co' WHERE slug = 'gooding'$$);

-- A source with no targets can still be renamed or removed.
UPDATE public.observation_sources SET display_name = 'Gooding & Company' WHERE slug = 'gooding';
INSERT INTO public.observation_sources (slug, display_name, category) VALUES ('spare', 'Spare', 'auction');
DELETE FROM public.observation_sources WHERE slug = 'spare';
SELECT pg_temp.ok('a source without targets is removable and a non-key edit is admitted',
  NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'spare')
  AND (SELECT display_name FROM public.observation_sources WHERE slug = 'gooding') = 'Gooding & Company');

-- Re-apply is a no-op ---------------------------------------------------------------------------------------------------
\ir ../migrations/20261013084500_key_source_targets_source_slug.sql
SELECT pg_temp.ok('re-applying the migration adds no second key',
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.source_targets'::regclass AND contype = 'f') = 1);

\echo 'source_targets source key contract: all checks passed'
