-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_sales -f this-file.sql
-- Contract for 20261015213000_family_sales_fold.sql. Synthetic rows only; never production.
-- mv_family_sales holds every dated confirmed sale keyed the way mv_family_market keys it:
--   * a sale of a named family carries the family's key; an undated or unpriced sale is not a dot;
--   * a family with under 3 sales, a name with no family and a car its family's years exclude all fall into "other",
--     exactly as in mv_family_market;
--   * treemap_family_sales returns a family's last five years, newest first, bounded; anon executes it;
--   * treemap_refresh_all refreshes the fold after mv_family_market; the migration applies twice.
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
  ('00000000-0000-4000-a000-000000000001', 'Porsche', 'Porsche', '{}');
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('00000000-0000-4000-b000-000000000001', 'Porsche', '911', 1964, NULL, '{911}'),
  ('00000000-0000-4000-b000-000000000002', 'Porsche', 'Cayenne', 2003, NULL, '{cayenne}'),
  ('00000000-0000-4000-b000-000000000004', 'Porsche', '356', 1948, 1965, '{356}'),
  ('00000000-0000-4000-b000-000000000005', 'Porsche', 'Boxster', 1997, NULL, '{boxster}');

-- 911: four dated sales (one six years ago), one with no date, one unsold. Cayenne: four sales in its years and a 1998
-- "Cayenne" before them (other). 356: three sales in its years and a 2020 "356 tribute" after them (other). A name with
-- no family (other). Boxster: two sales, under 3 (other).
INSERT INTO public.vehicles (id, make, model, sale_date, bat_sale_date) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Porsche', '911 Carrera', current_date - 30, NULL),
  ('00000000-0000-4000-8000-000000000002', 'Porsche', '911 Turbo', NULL, current_date - 400),
  ('00000000-0000-4000-8000-000000000003', 'Porsche', '911 Targa', current_date - 900, NULL),
  ('00000000-0000-4000-8000-000000000004', 'Porsche', '911 SC', current_date - 2200, NULL),
  ('00000000-0000-4000-8000-000000000005', 'Porsche', '911 Carrera', NULL, NULL),
  ('00000000-0000-4000-8000-000000000006', 'Porsche', '911 Carrera', current_date - 50, NULL),
  ('00000000-0000-4000-8000-000000000007', 'Porsche', 'Cayenne', current_date - 70, NULL),
  ('00000000-0000-4000-8000-000000000008', 'Porsche', 'Cayenne Turbo', current_date - 80, NULL),
  ('00000000-0000-4000-8000-000000000009', 'Porsche', '356 tribute', current_date - 90, NULL),
  ('00000000-0000-4000-8000-000000000010', 'Porsche', 'Speedster replica', current_date - 100, NULL),
  ('00000000-0000-4000-8000-000000000012', 'Porsche', 'Cayenne S', current_date - 110, NULL),
  ('00000000-0000-4000-8000-000000000013', 'Porsche', 'Cayenne', current_date - 120, NULL),
  ('00000000-0000-4000-8000-000000000014', 'Porsche', 'Cayenne', current_date - 130, NULL),
  ('00000000-0000-4000-8000-000000000015', 'Porsche', '356 Coupe', current_date - 140, NULL),
  ('00000000-0000-4000-8000-000000000016', 'Porsche', '356 Speedster', current_date - 150, NULL),
  ('00000000-0000-4000-8000-000000000017', 'Porsche', '356 SC', current_date - 160, NULL),
  ('00000000-0000-4000-8000-000000000018', 'Porsche', 'Boxster', current_date - 170, NULL),
  ('00000000-0000-4000-8000-000000000019', 'Porsche', 'Boxster S', current_date - 180, NULL);
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount, source_name) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Porsche', '911 Carrera', 1989, 'sold', 100000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000002', 'Porsche', '911 Turbo', 1995, 'sold', 200000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000003', 'Porsche', '911 Targa', 1972, 'sold', 80000, 'Mecum'),
  ('00000000-0000-4000-8000-000000000004', 'Porsche', '911 SC', 1981, 'sold', 40000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000005', 'Porsche', '911 Carrera', 1987, 'sold', 90000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000006', 'Porsche', '911 Carrera', 1990, 'not_sold', NULL, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000007', 'Porsche', 'Cayenne', 2005, 'sold', 9000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000008', 'Porsche', 'Cayenne Turbo', 2008, 'sold', 12000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000009', 'Porsche', '356 tribute', 2020, 'sold', 45000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000010', 'Porsche', 'Speedster replica', 1990, 'sold', 25000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000012', 'Porsche', 'Cayenne S', 2006, 'sold', 15000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000013', 'Porsche', 'Cayenne', 2004, 'sold', 8000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000014', 'Porsche', 'Cayenne', 1998, 'sold', 7000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000015', 'Porsche', '356 Coupe', 1960, 'sold', 120000, 'Gooding & Co'),
  ('00000000-0000-4000-8000-000000000016', 'Porsche', '356 Speedster', 1955, 'sold', 300000, 'Gooding & Co'),
  ('00000000-0000-4000-8000-000000000017', 'Porsche', '356 SC', 1964, 'sold', 140000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000018', 'Porsche', 'Boxster', 2000, 'sold', 12000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000019', 'Porsche', 'Boxster S', 2001, 'sold', 14000, 'Bring a Trailer');

\ir helpers/treemap_refresh_all_live_20261015.sql
\ir ../migrations/20261015060000_brand_market_fold.sql
\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261015131500_family_market_fold.sql
\ir ../migrations/20261015213000_family_sales_fold.sql
\ir ../migrations/20261015213000_family_sales_fold.sql

SELECT pg_temp.ok('the 911''s dated sales carry its key; undated and unsold ones are not dots',
  (SELECT array_agg(right(vehicle_id::text, 2) ORDER BY vehicle_id) FROM public.mv_family_sales
     WHERE family_key = '00000000-0000-4000-b000-000000000001') = ARRAY['01', '02', '03', '04']
  AND NOT EXISTS (SELECT 1 FROM public.mv_family_sales WHERE right(vehicle_id::text, 2) IN ('05', '06')));
SELECT pg_temp.ok('a sale date falls back to the BaT sale date',
  (SELECT sale_date FROM public.mv_family_sales WHERE right(vehicle_id::text, 2) = '02') = current_date - 400);
SELECT pg_temp.ok('under 3 sales, a year outside the family and no family all fall into "other", as on the map',
  (SELECT array_agg(right(vehicle_id::text, 2) ORDER BY vehicle_id) FROM public.mv_family_sales WHERE family_key = 'other')
    = ARRAY['09', '10', '14', '18', '19']
  AND (SELECT array_agg(right(vehicle_id::text, 2) ORDER BY vehicle_id) FROM public.mv_family_sales
         WHERE family_key = '00000000-0000-4000-b000-000000000002') = ARRAY['07', '08', '12', '13']
  AND (SELECT array_agg(right(vehicle_id::text, 2) ORDER BY vehicle_id) FROM public.mv_family_sales
         WHERE family_key = '00000000-0000-4000-b000-000000000004') = ARRAY['15', '16', '17']
  AND NOT EXISTS (SELECT 1 FROM public.mv_family_sales s WHERE s.family_key <> 'other'
                  AND NOT EXISTS (SELECT 1 FROM public.mv_family_market m WHERE m.brand = s.brand AND m.family_key = s.family_key)));
SELECT pg_temp.ok('the reader returns the last five years, newest first, bounded',
  (SELECT array_agg(right(vehicle_id::text, 2) ORDER BY n) FROM (
     SELECT vehicle_id, row_number() OVER () n FROM public.treemap_family_sales('Porsche', '00000000-0000-4000-b000-000000000001')) x)
    = ARRAY['01', '02', '03']
  AND (SELECT count(*) FROM public.treemap_family_sales('Porsche', '00000000-0000-4000-b000-000000000001', 1)) = 1
  AND (SELECT source FROM public.treemap_family_sales('Porsche', '00000000-0000-4000-b000-000000000001') WHERE right(vehicle_id::text, 2) = '03') = 'Mecum');
SELECT pg_temp.ok('treemap_refresh_all refreshes the fold after mv_family_market',
  position('''mv_family_market'',' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.treemap_refresh_all()'::regprocedure))
    < position('''mv_family_sales''' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.treemap_refresh_all()'::regprocedure)));
SELECT pg_temp.ok('PUBLIC cannot execute the reader; anon can, and can read the fold',
  NOT has_function_privilege('public', 'public.treemap_family_sales(text,text,integer)', 'execute')
  AND has_function_privilege('anon', 'public.treemap_family_sales(text,text,integer)', 'execute')
  AND has_table_privilege('anon', 'public.mv_family_sales', 'select'));

-- A new dated sale reaches the chart through the refresh.
INSERT INTO public.vehicles (id, make, model, sale_date) VALUES ('00000000-0000-4000-8000-000000000011', 'Porsche', '911 GT3', current_date - 5);
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount, source_name) VALUES
  ('00000000-0000-4000-8000-000000000011', 'Porsche', '911 GT3', 2004, 'sold', 150000, 'Bring a Trailer');
-- (names refresh daily at 04:05 UTC, the map's folds at 09:10, in that order)
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_sales;
SELECT pg_temp.ok('the refresh adds the new sale at the top of its family',
  (SELECT right(vehicle_id::text, 2) FROM public.treemap_family_sales('Porsche', '00000000-0000-4000-b000-000000000001', 1)) = '11');
