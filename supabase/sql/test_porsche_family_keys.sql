-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_porsche_keys -f this-file.sql
-- Contract for 20261015163000_porsche_family_keys.sql. Synthetic rows only; never production.
-- With a 911 row whose aliases include "carrera" (as in production), a Carrera GT keys to the 911 before the migration
-- and to its own family after it; a "911SC" written as one word keys to the 911; a 959 Komfort keys to the 959; the
-- refreshed mv_family_market no longer lists a Carrera GT name under the 911; the migration applies twice.
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
CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, canonical_name text, display_name text, short_name text,
  aliases text[], country_of_origin text, founded_year integer, parent_company text, is_active boolean,
  created_at timestamptz, brand_tier text);
CREATE TABLE public.canonical_models (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text NOT NULL, canonical_model text NOT NULL,
  canonical_series text, year_start integer, year_end integer, body_styles text[], aliases text[] NOT NULL, generation text,
  notes text, created_at timestamptz DEFAULT now());
CREATE VIEW public.mv_vehicle_name_dictionary AS
  SELECT lower(make) AS make_l, lower(coalesce(model, '')) AS model_l, lower(make || ' ' || coalesce(model, '')) AS name_l,
         count(*)::bigint AS vehicles
  FROM public.vehicles WHERE make IS NOT NULL GROUP BY 1, 2, 3;

INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000001', 'Porsche', 'Porsche', '{}');
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('00000000-0000-4000-b000-000000000001', 'Porsche', '911', 1964, NULL, '{911,911 carrera,911sc coupe,carrera,carrera coupe}');

-- Three Carrera GTs (enough to name a family), three 911s (one written "911SC"), one 959 Komfort.
INSERT INTO public.vehicles (id, make, model) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Porsche', 'Carrera GT'),
  ('00000000-0000-4000-8000-000000000002', 'Porsche', 'Carrera GT'),
  ('00000000-0000-4000-8000-000000000003', 'Porsche', 'Carrera GT'),
  ('00000000-0000-4000-8000-000000000004', 'Porsche', '911 Carrera'),
  ('00000000-0000-4000-8000-000000000005', 'Porsche', '911SC'),
  ('00000000-0000-4000-8000-000000000006', 'Porsche', '911 Carrera'),
  ('00000000-0000-4000-8000-000000000007', 'Porsche', '959 Komfort');
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Porsche', 'Carrera GT', 2004, 'sold', 1500000),
  ('00000000-0000-4000-8000-000000000002', 'Porsche', 'Carrera GT', 2005, 'sold', 1600000),
  ('00000000-0000-4000-8000-000000000003', 'Porsche', 'Carrera GT', 2005, 'sold', 1700000),
  ('00000000-0000-4000-8000-000000000004', 'Porsche', '911 Carrera', 1989, 'sold', 100000),
  ('00000000-0000-4000-8000-000000000005', 'Porsche', '911SC', 1981, 'sold', 60000),
  ('00000000-0000-4000-8000-000000000006', 'Porsche', '911 Carrera', 1987, 'sold', 90000),
  ('00000000-0000-4000-8000-000000000007', 'Porsche', '959 Komfort', 1987, 'sold', 1800000);

\ir helpers/treemap_refresh_all_live_20261015.sql
\ir ../migrations/20261015060000_brand_market_fold.sql
\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261015131500_family_market_fold.sql

SELECT pg_temp.ok('before: the Carrera GT keys to the 911 through the alias "carrera"',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'porsche' AND model_l = 'carrera gt') = '911');

\ir ../migrations/20261015163000_porsche_family_keys.sql
\ir ../migrations/20261015163000_porsche_family_keys.sql

SELECT pg_temp.ok('the Carrera GT keys to its own family',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'porsche' AND model_l = 'carrera gt') = 'Carrera GT');
SELECT pg_temp.ok('a 911SC written as one word keys to the 911',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'porsche' AND model_l = '911sc') = '911');
SELECT pg_temp.ok('a 959 Komfort keys to the 959',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'porsche' AND model_l = '959 komfort') = '959');
SELECT pg_temp.ok('the drill lists the Carrera GT as a family, not as a 911 name',
  (SELECT sold FROM public.treemap_brand_families('Porsche') WHERE family = 'Carrera GT') = 3
  AND NOT EXISTS (SELECT 1 FROM public.mv_family_market WHERE brand = 'Porsche' AND family = '911' AND model_key = 'carrera gt')
  AND (SELECT sold FROM public.treemap_brand_families('Porsche') WHERE family = '911') = 3);
SELECT pg_temp.ok('applied twice: one row per added family, no duplicate aliases',
  (SELECT count(*) FROM public.canonical_models WHERE make = 'Porsche' AND canonical_model = 'Carrera GT') = 1
  AND (SELECT count(*) FROM unnest((SELECT aliases FROM public.canonical_models WHERE canonical_model = '911')) a WHERE a = '911sc') = 1);
