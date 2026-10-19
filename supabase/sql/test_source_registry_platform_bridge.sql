-- Isolated PostgreSQL 17 regression: synthetic rows only, never production data.
-- Contract for 20261015020000_key_source_registry_platforms_to_observation_sources.sql: the migration fills
-- source_registry.observation_source_id for its 21 named platforms (19 exact slugs, bringatrailer -> bat and
-- broadarrow -> broad-arrow), leaves an already-set row and unnamed rows alone, picks the hyphen spelling where the
-- platform entity holds a separator twin, writes the column comment, and applies twice without change. (The failure
-- path, a named target without an entity row, is the migration's own RAISE; it is not exercised here.)
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
   OR current_setting('server_version_num')::int / 10000 <> 17
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';

-- The columns the migration reads and writes, with the live keys.
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE);
CREATE TABLE public.source_registry(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
  observation_source_id uuid REFERENCES public.observation_sources(id));
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

-- Platform entity rows: the 21 targets, two separator twins, and the row an existing bridge points at.
INSERT INTO public.observation_sources(slug) VALUES
  ('barrett-jackson'), ('bat'), ('broad-arrow'), ('broad_arrow'), ('carandclassic'), ('cars-and-bids'),
  ('cars_and_bids'), ('classic-com'), ('classic-driver'), ('collecting-cars'), ('copart'), ('craigslist'),
  ('dupont-registry'), ('dyler'), ('er-classics'), ('hagerty-marketplace'), ('hemmings'), ('manheim'), ('mecum'),
  ('pcarmarket'), ('rennlist'), ('rm-sothebys'), ('russo-and-steele'), ('silodrome');
-- Registry rows: the 21 targets, one already bridged (silodrome), one with no entity row (gaa-classic-cars).
INSERT INTO public.source_registry(slug) VALUES
  ('barrett-jackson'), ('bringatrailer'), ('broadarrow'), ('carandclassic'), ('cars-and-bids'), ('classic-com'),
  ('classic-driver'), ('collecting-cars'), ('copart'), ('craigslist'), ('dupont-registry'), ('dyler'), ('er-classics'),
  ('hagerty-marketplace'), ('hemmings'), ('manheim'), ('mecum'), ('pcarmarket'), ('rennlist'), ('rm-sothebys'),
  ('russo-and-steele'), ('gaa-classic-cars');
INSERT INTO public.source_registry(slug, observation_source_id)
  SELECT 'silodrome', id FROM public.observation_sources WHERE slug = 'silodrome';

\ir ../migrations/20261015020000_key_source_registry_platforms_to_observation_sources.sql
CREATE TEMP TABLE first_pass AS SELECT slug, observation_source_id FROM public.source_registry;
-- A second application changes nothing and passes the migration's own assertion.
\ir ../migrations/20261015020000_key_source_registry_platforms_to_observation_sources.sql

SELECT pg_temp.ok('21 named platforms are bridged',
  (SELECT count(*) = 21 FROM public.source_registry r
     WHERE r.slug <> 'silodrome' AND r.observation_source_id IS NOT NULL));
SELECT pg_temp.ok('exact slugs bridge to the same slug',
  (SELECT bool_and(o.slug = r.slug) FROM public.source_registry r JOIN public.observation_sources o
     ON o.id = r.observation_source_id WHERE r.slug NOT IN ('bringatrailer', 'broadarrow')));
SELECT pg_temp.ok('bringatrailer bridges to bat',
  (SELECT o.slug = 'bat' FROM public.source_registry r JOIN public.observation_sources o
     ON o.id = r.observation_source_id WHERE r.slug = 'bringatrailer'));
SELECT pg_temp.ok('broadarrow bridges to the hyphen twin',
  (SELECT o.slug = 'broad-arrow' FROM public.source_registry r JOIN public.observation_sources o
     ON o.id = r.observation_source_id WHERE r.slug = 'broadarrow'));
SELECT pg_temp.ok('cars-and-bids bridges to the hyphen twin, not cars_and_bids',
  (SELECT o.slug = 'cars-and-bids' FROM public.source_registry r JOIN public.observation_sources o
     ON o.id = r.observation_source_id WHERE r.slug = 'cars-and-bids'));
SELECT pg_temp.ok('an already-set bridge is left alone',
  (SELECT o.slug = 'silodrome' FROM public.source_registry r JOIN public.observation_sources o
     ON o.id = r.observation_source_id WHERE r.slug = 'silodrome'));
SELECT pg_temp.ok('a platform with no entity row stays NULL',
  (SELECT observation_source_id IS NULL FROM public.source_registry WHERE slug = 'gaa-classic-cars'));
SELECT pg_temp.ok('the second application changed nothing',
  NOT EXISTS (SELECT 1 FROM public.source_registry r JOIN first_pass f USING (slug)
               WHERE r.observation_source_id IS DISTINCT FROM f.observation_source_id));
SELECT pg_temp.ok('the column carries its comment',
  col_description('public.source_registry'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.source_registry'::regclass
       AND attname = 'observation_source_id')) LIKE '%20261015020000 bridges 21 registry slugs%');
