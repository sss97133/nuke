-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_feed_key_gaps -f this-file.sql
-- Contract for 20261015203000_feed_key_gaps.sql. Synthetic rows only; never production.
-- Names the classifieds feed wrote that keyed to no family key after the migration: spellings on existing families
-- (rivera, e350, es300, landcruiser, 240, b200) and new families (Rebel, Kingswood, Chevy Van, Grand Ville); an
-- unrelated family keeps its names; the migration applies twice without duplicate rows or spellings.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.mv_treemap_outcomes') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, model text, sale_date date, bat_sale_date date);
CREATE TABLE public.mv_treemap_outcomes (id uuid PRIMARY KEY, brand_name text, model text, year integer, source_name text,
  outcome text, sale_basis text, sold_amount numeric, bat_bids integer, bat_watchers integer);
CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_name text, display_name text,
  short_name text, aliases text[], country_of_origin text, founded_year integer, parent_company text, is_active boolean,
  created_at timestamptz, brand_tier text);
CREATE TABLE public.canonical_models (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text NOT NULL, canonical_model text NOT NULL,
  canonical_series text, year_start integer, year_end integer, body_styles text[], aliases text[] NOT NULL DEFAULT '{}',
  generation text, notes text, created_at timestamptz DEFAULT now());
CREATE VIEW public.mv_vehicle_name_dictionary AS
  SELECT lower(make) AS make_l, lower(coalesce(model, '')) AS model_l, lower(make || ' ' || coalesce(model, '')) AS name_l,
         count(*)::bigint AS vehicles
  FROM public.vehicles WHERE make IS NOT NULL GROUP BY 1, 2, 3;

INSERT INTO public.canonical_makes (canonical_name, display_name, aliases) VALUES
  ('BUICK', 'Buick', '{buick}'), ('FORD', 'Ford', '{ford}'), ('LEXUS', 'Lexus', '{}'), ('TOYOTA', 'Toyota', '{toyota}'),
  ('VOLVO', 'Volvo', '{}'), ('DODGE', 'Dodge', '{dodge}'), ('AMC', 'AMC', '{amc}'), ('CHEVROLET', 'Chevrolet', '{chevrolet,chevy}'),
  ('PONTIAC', 'Pontiac', '{pontiac}');
INSERT INTO public.canonical_models (make, canonical_model, year_start, year_end, aliases) VALUES
  ('Buick', 'Riviera', 1963, 1999, '{riviera,riviera gs}'), ('Buick', 'Riviera', 1963, 1999, '{riviera}'),
  ('Ford', 'E-350', NULL, NULL, '{e-350}'), ('Lexus', 'ES', NULL, NULL, '{es}'),
  ('Toyota', 'Land Cruiser', 1951, NULL, '{land cruiser,fj40}'), ('Volvo', '240 Series', NULL, NULL, '{240 series}'),
  ('Dodge', 'Ram Van', NULL, NULL, '{ram van}'), ('Chevrolet', 'C10', 1960, 1987, '{c10}');

INSERT INTO public.vehicles (id, make, model) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Buick', 'Rivera'),
  ('00000000-0000-4000-8000-000000000002', 'Ford', 'E350'),
  ('00000000-0000-4000-8000-000000000003', 'Lexus', 'ES300'),
  ('00000000-0000-4000-8000-000000000004', 'Toyota', 'Landcruiser'),
  ('00000000-0000-4000-8000-000000000005', 'Volvo', '240'),
  ('00000000-0000-4000-8000-000000000006', 'Dodge', 'B200'),
  ('00000000-0000-4000-8000-000000000007', 'AMC', 'Rebel'),
  ('00000000-0000-4000-8000-000000000008', 'Chevrolet', 'Kingswood'),
  ('00000000-0000-4000-8000-000000000009', 'Chevrolet', 'G20 Van'),
  ('00000000-0000-4000-8000-000000000010', 'Pontiac', 'Grandville Convertible'),
  ('00000000-0000-4000-8000-000000000011', 'Chevrolet', 'C10');

\ir helpers/treemap_refresh_all_live_20261015.sql
\ir ../migrations/20261015060000_brand_market_fold.sql
\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261015131500_family_market_fold.sql

SELECT pg_temp.ok('before: the feed''s names key to no family',
  (SELECT count(*) FROM public.mv_model_family_names WHERE family IS NULL) = 10);

\ir ../migrations/20261015203000_feed_key_gaps.sql
\ir ../migrations/20261015203000_feed_key_gaps.sql

CREATE FUNCTION pg_temp.fam(m text, n text) RETURNS text LANGUAGE sql AS
$$ SELECT family FROM public.mv_model_family_names WHERE make_l = m AND model_l = n $$;

SELECT pg_temp.ok('spellings key to the existing families',
  pg_temp.fam('buick', 'rivera') = 'Riviera' AND pg_temp.fam('ford', 'e350') = 'E-350' AND pg_temp.fam('lexus', 'es300') = 'ES'
  AND pg_temp.fam('toyota', 'landcruiser') = 'Land Cruiser' AND pg_temp.fam('volvo', '240') = '240 Series'
  AND pg_temp.fam('dodge', 'b200') = 'Ram Van');
SELECT pg_temp.ok('new families take their names',
  pg_temp.fam('amc', 'rebel') = 'Rebel' AND pg_temp.fam('chevrolet', 'kingswood') = 'Kingswood'
  AND pg_temp.fam('chevrolet', 'g20 van') = 'Chevy Van' AND pg_temp.fam('pontiac', 'grandville convertible') = 'Grand Ville');
SELECT pg_temp.ok('an unrelated family keeps its names', pg_temp.fam('chevrolet', 'c10') = 'C10');
SELECT pg_temp.ok('applied twice: one row per new family, each spelling once on each row',
  (SELECT count(*) FROM public.canonical_models WHERE make = 'AMC' AND canonical_model = 'Rebel') = 1
  AND (SELECT bool_and((SELECT count(*) FROM unnest(aliases) a WHERE a = 'rivera') = 1) FROM public.canonical_models WHERE canonical_model = 'Riviera')
  AND (SELECT count(*) FROM public.canonical_models WHERE canonical_model = 'Riviera') = 2);
