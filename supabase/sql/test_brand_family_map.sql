-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_brand_family_map -f this-file.sql
-- Contract for 20261015223000_brand_family_map.sql. Synthetic rows only; never production.
-- treemap_brand_family_map returns the largest brands, each with its largest named families, one "more" row for the
-- rest and "other" for unkeyed names, so a brand's rows add up to the brand; brands and families are bounded; the
-- 12-month columns are BaT only; anon executes it, PUBLIC does not; the migration applies twice.
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
CREATE TABLE public.canonical_models (id uuid PRIMARY KEY, make text, canonical_model text, canonical_series text,
  year_start integer, year_end integer, body_styles text[], aliases text[], generation text, notes text, created_at timestamptz);
CREATE VIEW public.mv_vehicle_name_dictionary AS
  SELECT lower(make) AS make_l, lower(coalesce(model, '')) AS model_l, lower(make || ' ' || coalesce(model, '')) AS name_l,
         count(*)::bigint AS vehicles
  FROM public.vehicles WHERE make IS NOT NULL GROUP BY 1, 2, 3;

INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000001', 'Porsche', 'Porsche', '{}'),
  ('00000000-0000-4000-a000-000000000002', 'Ferrari', 'Ferrari', '{}'),
  ('00000000-0000-4000-a000-000000000003', 'Lancia', 'Lancia', '{}');
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('00000000-0000-4000-b000-000000000001', 'Porsche', '911', 1964, NULL, '{911}'),
  ('00000000-0000-4000-b000-000000000002', 'Porsche', 'Boxster', 1997, NULL, '{boxster}'),
  ('00000000-0000-4000-b000-000000000003', 'Ferrari', '360', 1999, 2005, '{360}'),
  ('00000000-0000-4000-b000-000000000004', 'Lancia', 'Delta', 1979, 1999, '{delta}');

-- Porsche: 911 x3 ($300,000; all three on BaT in the last 12 months), Boxster x3 ($60,000), one unkeyed name ($20,000).
-- Ferrari: 360 x3 ($450,000). Lancia: Delta x3 ($90,000), the smallest brand.
INSERT INTO public.vehicles (id, make, model, sale_date)
SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, mk, md, current_date - 30 * n
FROM (VALUES (1, 'Porsche', '911 Carrera'), (2, 'Porsche', '911 Turbo'), (3, 'Porsche', '911 SC'),
             (4, 'Porsche', 'Boxster'), (5, 'Porsche', 'Boxster S'), (6, 'Porsche', 'Boxster'),
             (7, 'Porsche', 'Speedster replica'),
             (8, 'Ferrari', '360 Modena'), (9, 'Ferrari', '360 Spider'), (10, 'Ferrari', '360 Modena'),
             (11, 'Lancia', 'Delta Integrale'), (12, 'Lancia', 'Delta'), (13, 'Lancia', 'Delta HF')) AS x(n, mk, md);
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount, source_name)
SELECT v.id, v.make, v.model,
       CASE WHEN v.model LIKE '911%' THEN 1989 WHEN v.model LIKE 'Boxster%' THEN 2001 WHEN v.model LIKE '360%' THEN 2002
            WHEN v.model LIKE 'Delta%' THEN 1992 ELSE 1990 END,
       'sold',
       CASE WHEN v.model LIKE '911%' THEN 100000 WHEN v.model LIKE 'Boxster%' THEN 20000 WHEN v.model LIKE '360%' THEN 150000
            WHEN v.model LIKE 'Delta%' THEN 30000 ELSE 20000 END,
       'Bring a Trailer'
FROM public.vehicles v;

\ir helpers/treemap_refresh_all_live_20261015.sql
\ir ../migrations/20261015060000_brand_market_fold.sql
\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261015131500_family_market_fold.sql
\ir ../migrations/20261015223000_brand_family_map.sql
\ir ../migrations/20261015223000_brand_family_map.sql

CREATE TEMP VIEW m AS SELECT * FROM public.treemap_brand_family_map(2, 1);

SELECT pg_temp.ok('the largest brands only, largest first',
  (SELECT array_agg(DISTINCT brand ORDER BY brand) FROM m) = ARRAY['Ferrari', 'Porsche']
  AND (SELECT min(brand_rank) FROM m WHERE brand = 'Ferrari') = 1);
SELECT pg_temp.ok('a brand''s largest families, then one "more" row for the rest and "other" for unkeyed names',
  (SELECT array_agg(coalesce(family, family_key) ORDER BY n) FROM (SELECT family, family_key, row_number() OVER () n FROM m WHERE brand = 'Porsche') x)
    = ARRAY['911', 'more', 'other']
  AND (SELECT usd FROM m WHERE brand = 'Porsche' AND family_key = 'more') = 60000);
SELECT pg_temp.ok('a brand''s rows add up to the brand',
  (SELECT bool_and(t.s = t.b) FROM (SELECT brand, sum(usd) s, max(brand_usd) b FROM m GROUP BY brand) t)
  AND (SELECT max(brand_usd) FROM m WHERE brand = 'Porsche') = 380000);
SELECT pg_temp.ok('the 12-month columns are BaT only, and families counts the named ones',
  (SELECT sold_12m = 3 AND dated = 3 AND families = 2 FROM m WHERE brand = 'Porsche' AND family = '911'));
SELECT pg_temp.ok('bounds: brands and families',
  (SELECT count(DISTINCT brand) FROM public.treemap_brand_family_map(500, 1)) = 3
  AND (SELECT count(*) FROM public.treemap_brand_family_map(1, 99) WHERE brand = 'Ferrari') = 1);
SELECT pg_temp.ok('PUBLIC cannot execute it; anon can',
  NOT has_function_privilege('public', 'public.treemap_brand_family_map(integer,integer)', 'execute')
  AND has_function_privilege('anon', 'public.treemap_brand_family_map(integer,integer)', 'execute'));
