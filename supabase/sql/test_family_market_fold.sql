-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_market -f this-file.sql
-- Contract for 20261015131500_family_market_fold.sql. Synthetic rows only; never production.
-- The confirmed-sale map's fold (mv_treemap_outcomes, here a table), vehicles (make, model, sale dates), the brand fold
-- (20261015060000) and the family names (20261015090000) feed mv_family_market:
--   * a brand's sales group by factory model family; a family with under 3 sales, and a sale whose name has no family,
--     fall into one "other" family per brand, so the drill shows its coverage;
--   * a family whose year range excludes the car does not claim it;
--   * the measures (sold, sold_any, offered, dollars, 12 months against the 12 before) match their hand counts;
--   * inside a family, model names group by lower(model) under their most common spelling, and each one counts the same
--     sales treemap_years and treemap_sales match;
--   * treemap_brand_families orders by dollars with "other" last; treemap_family_models lists a family's sold names by
--     dollars; anon executes both; treemap_refresh_all refreshes the fold after mv_brand_market, concurrently; the
--     migration applies twice.
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
-- The name dictionary is a view over vehicles here, so it always holds the fixture's names.
CREATE VIEW public.mv_vehicle_name_dictionary AS
  SELECT lower(make) AS make_l, lower(coalesce(model, '')) AS model_l, lower(make || ' ' || coalesce(model, '')) AS name_l,
         count(*)::bigint AS vehicles
  FROM public.vehicles WHERE make IS NOT NULL GROUP BY 1, 2, 3;

INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000001', 'Porsche', 'Porsche', '{}');
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('00000000-0000-4000-b000-000000000001', 'Porsche', '911', 1964, NULL, '{911}'),
  ('00000000-0000-4000-b000-000000000002', 'Porsche', 'Boxster', 1997, NULL, '{boxster}'),
  ('00000000-0000-4000-b000-000000000003', 'Porsche', 'Cayenne', 2003, NULL, '{cayenne}'),
  ('00000000-0000-4000-b000-000000000004', 'Porsche', '356', 1948, 1965, '{356}');

-- Porsche: six 911s (one unsold; "911 Carrera" spelled twice one way and once "911 carrera"), three Boxsters, two
-- Cayennes (under 3: other), one name with no family (other), one sale with no model name (other), and two cars whose
-- family's years exclude them (other): a 2020 "356 tribute" after the 356's last year and a 1994 "Boxster prototype"
-- before the Boxster's first. Sale dates: 911 g 1, 2 in the last 12 months; g 3 in the 12 before.
INSERT INTO public.vehicles (id, make, model, sale_date) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Porsche', '911 Carrera', current_date - 30),
  ('00000000-0000-4000-8000-000000000002', 'Porsche', '911 Turbo', current_date - 60),
  ('00000000-0000-4000-8000-000000000003', 'Porsche', '911 Targa', current_date - 400),
  ('00000000-0000-4000-8000-000000000004', 'Porsche', '911 SC', NULL),
  ('00000000-0000-4000-8000-000000000005', 'Porsche', 'Boxster S', NULL),
  ('00000000-0000-4000-8000-000000000006', 'Porsche', 'Boxster', NULL),
  ('00000000-0000-4000-8000-000000000007', 'Porsche', 'Boxster Spyder', NULL),
  ('00000000-0000-4000-8000-000000000008', 'Porsche', 'Cayenne', NULL),
  ('00000000-0000-4000-8000-000000000009', 'Porsche', 'Cayenne Turbo', NULL),
  ('00000000-0000-4000-8000-000000000010', 'Porsche', 'Speedster replica kit', NULL),
  ('00000000-0000-4000-8000-000000000011', 'Porsche', '356 tribute', NULL),
  ('00000000-0000-4000-8000-000000000013', 'Porsche', '356 Speedster', NULL),
  ('00000000-0000-4000-8000-000000000014', 'Porsche', '356 Coupe', NULL),
  ('00000000-0000-4000-8000-000000000015', 'Porsche', '911 carrera', NULL),
  ('00000000-0000-4000-8000-000000000016', 'Porsche', '911 Carrera', NULL),
  ('00000000-0000-4000-8000-000000000017', 'Porsche', NULL, NULL),
  ('00000000-0000-4000-8000-000000000018', 'Porsche', 'Boxster prototype', NULL);
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount) VALUES
  ('00000000-0000-4000-8000-000000000013', 'Porsche', '356 Speedster', 1955, 'sold', 300000),
  ('00000000-0000-4000-8000-000000000014', 'Porsche', '356 Coupe', 1960, 'sold', 120000),
  ('00000000-0000-4000-8000-000000000015', 'Porsche', '911 carrera', 1990, 'sold', 110000),
  ('00000000-0000-4000-8000-000000000017', 'Porsche', NULL, 1970, 'sold', 5000),
  ('00000000-0000-4000-8000-000000000018', 'Porsche', 'Boxster prototype', 1994, 'sold', 7000);
-- The 12-month move counts Bring a Trailer only: g 1 and 3 sold there; g 2 sold at Mecum inside the window and does not
-- move it; g 16 sold on BaT with no recorded date, so it is not dated.
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount, source_name) VALUES
  ('00000000-0000-4000-8000-000000000016', 'Porsche', '911 Carrera', 1987, 'sold', 90000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000001', 'Porsche', '911 Carrera', 1989, 'sold', 100000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000002', 'Porsche', '911 Turbo', 1995, 'sold', 200000, 'Mecum'),
  ('00000000-0000-4000-8000-000000000003', 'Porsche', '911 Targa', 1972, 'sold', 80000, 'Bring a Trailer');
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount) VALUES
  ('00000000-0000-4000-8000-000000000004', 'Porsche', '911 SC', 1981, 'not_sold', NULL),
  ('00000000-0000-4000-8000-000000000005', 'Porsche', 'Boxster S', 2002, 'sold', 20000),
  ('00000000-0000-4000-8000-000000000006', 'Porsche', 'Boxster', 1999, 'sold', 15000),
  ('00000000-0000-4000-8000-000000000007', 'Porsche', 'Boxster Spyder', 2011, 'sold', 60000),
  ('00000000-0000-4000-8000-000000000008', 'Porsche', 'Cayenne', 2005, 'sold', 9000),
  ('00000000-0000-4000-8000-000000000009', 'Porsche', 'Cayenne Turbo', 2008, 'sold', 12000),
  ('00000000-0000-4000-8000-000000000010', 'Porsche', 'Speedster replica kit', 1990, 'sold', 25000),
  ('00000000-0000-4000-8000-000000000011', 'Porsche', '356 tribute', 2020, 'sold', 45000);

\ir helpers/treemap_refresh_all_live_20261015.sql
\ir ../migrations/20261015060000_brand_market_fold.sql
\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261015131500_family_market_fold.sql
\ir ../migrations/20261015131500_family_market_fold.sql

-- The readers, read again by every check (a temporary view is re-planned each time).
CREATE TEMP VIEW fam AS SELECT * FROM public.treemap_brand_families('Porsche');
CREATE TEMP VIEW m911 AS SELECT * FROM public.treemap_family_models('Porsche', '00000000-0000-4000-b000-000000000001');

SELECT pg_temp.ok('a family with three or more sales is named, with its measures',
  (SELECT family = '911' AND sold = 5 AND sold_any = 5 AND offered = 6 AND usd = 580000 AND models = 3
     FROM fam WHERE family_key = '00000000-0000-4000-b000-000000000001'));
SELECT pg_temp.ok('the last 12 months against the 12 before, on Bring a Trailer only (the Mecum sale does not move it)',
  (SELECT sold_12m = 1 AND sold_prior_12m = 1 AND usd_12m = 100000 AND usd_prior_12m = 80000 AND dated = 2
     FROM fam WHERE family_key = '00000000-0000-4000-b000-000000000001'));
SELECT pg_temp.ok('the brand tile keeps every venue''s dollars and sales and takes its 12-month move from BaT',
  (SELECT m.usd = b.usd AND m.sold = b.sold AND m.sold_12m = 1 AND m.sold_prior_12m = 1 AND m.usd_12m = 100000
          AND m.usd_prior_12m = 80000 AND m.dated = 2
     FROM public.treemap_brand_market() m JOIN public.mv_brand_market b ON b.name = m.name WHERE m.name = 'Porsche')
  AND (SELECT sold_12m FROM public.mv_brand_market WHERE name = 'Porsche') = 2);
SELECT pg_temp.ok('Boxster: three sales, named',
  (SELECT sold = 3 AND usd = 95000 FROM fam WHERE family_key = '00000000-0000-4000-b000-000000000002'));
SELECT pg_temp.ok('under 3 sales, no family, no model name, and a family that excludes the year all fall into "other"',
  (SELECT sold = 8 AND usd = 523000 AND family IS NULL FROM fam WHERE family_key = 'other')
  AND (SELECT count(*) FROM fam) = 3);
SELECT pg_temp.ok('a 2020 "356 tribute" is not a 356: the family keeps its two real sales and stays unnamed',
  NOT EXISTS (SELECT 1 FROM fam WHERE family_key = '00000000-0000-4000-b000-000000000004'));
SELECT pg_temp.ok('a 1994 "Boxster prototype" is not a Boxster: the family keeps its three',
  (SELECT models = 3 FROM fam WHERE family_key = '00000000-0000-4000-b000-000000000002'));
SELECT pg_temp.ok('the families and other add up to the brand',
  (SELECT sum(usd) FROM fam) = (SELECT usd FROM public.mv_brand_market WHERE name = 'Porsche')
  AND (SELECT sum(sold) FROM fam) = (SELECT sold FROM public.mv_brand_market WHERE name = 'Porsche')
  AND (SELECT sum(offered) FROM fam) = (SELECT count(*) FROM public.mv_treemap_outcomes WHERE brand_name = 'Porsche'));
SELECT pg_temp.ok('the families reader orders by dollars with "other" last',
  (SELECT array_agg(coalesce(family, 'other') ORDER BY n) FROM (SELECT family, row_number() OVER () n FROM fam) x)
    = ARRAY['911', 'Boxster', 'other']);

SELECT pg_temp.ok('a family''s names group by spelling, largest dollars first, sold names only',
  (SELECT array_agg(model ORDER BY n) FROM (SELECT model, row_number() OVER () n FROM m911) x)
    = ARRAY['911 Carrera', '911 Turbo', '911 Targa']
  AND (SELECT sold = 3 AND sold_any = 3 AND offered = 3 AND usd = 300000 AND sold_12m = 1 AND dated = 1
         FROM m911 WHERE model = '911 Carrera'));
SELECT pg_temp.ok('each name counts the sales treemap_years and treemap_sales match (lower(model))',
  (SELECT bool_and(m.sold = (SELECT count(*) FROM public.mv_treemap_outcomes o
                              WHERE o.brand_name = 'Porsche' AND lower(o.model) = lower(m.model) AND o.sold_amount > 0))
     FROM m911 m));
SELECT pg_temp.ok('the family''s names add up to the family (its unsold name has no tile)',
  (SELECT sum(usd) FROM m911) = (SELECT usd FROM fam WHERE family_key = '00000000-0000-4000-b000-000000000001')
  AND (SELECT sum(sold) FROM m911) = (SELECT sold FROM fam WHERE family_key = '00000000-0000-4000-b000-000000000001'));
SELECT pg_temp.ok('"other" lists the names still to key, and a sale with no model name as null',
  (SELECT array_agg(coalesce(model, '(none)') ORDER BY usd DESC, model) FROM public.treemap_family_models('Porsche', 'other'))
    = ARRAY['356 Speedster', '356 Coupe', '356 tribute', 'Speedster replica kit', 'Cayenne Turbo', 'Cayenne',
            'Boxster prototype', '(none)']);

-- A new sale reaches the drill through the treemap refresh, after mv_brand_market.
INSERT INTO public.vehicles (id, make, model, sale_date) VALUES ('00000000-0000-4000-8000-000000000012', 'Porsche', 'Cayenne GTS', current_date - 10);
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount) VALUES
  ('00000000-0000-4000-8000-000000000012', 'Porsche', 'Cayenne GTS', 2012, 'sold', 30000);
-- (mv_treemap_outcomes is a table in this contract, so the fold is refreshed directly, the way treemap_refresh_all does
-- it; the function's list is checked below.)
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;
SELECT pg_temp.ok('the refresh names the Cayenne once it has three sales',
  (SELECT sold = 3 AND usd = 51000 AND models = 3 FROM fam WHERE family_key = '00000000-0000-4000-b000-000000000003')
  AND (SELECT sold = 6 AND usd = 502000 FROM fam WHERE family_key = 'other'));
SELECT pg_temp.ok('treemap_refresh_all lists the fold after mv_brand_market',
  position('''mv_brand_market'',' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.treemap_refresh_all()'::regprocedure))
    < position('''mv_family_market''' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.treemap_refresh_all()'::regprocedure)));

SELECT pg_temp.ok('PUBLIC cannot execute the readers; anon can',
  NOT has_function_privilege('public', 'public.treemap_brand_families(text)', 'execute')
  AND NOT has_function_privilege('public', 'public.treemap_family_models(text,text)', 'execute')
  AND has_function_privilege('anon', 'public.treemap_brand_families(text)', 'execute')
  AND has_function_privilege('anon', 'public.treemap_family_models(text,text)', 'execute')
  AND has_table_privilege('anon', 'public.mv_family_market', 'select'));
GRANT EXECUTE ON FUNCTION pg_temp.ok(text, boolean) TO anon;
SET ROLE anon;
SELECT pg_temp.ok('anon: the same families and names',
  (SELECT count(*) FROM public.treemap_brand_families('Porsche')) = 4
  AND (SELECT count(*) FROM public.treemap_family_models('Porsche', '00000000-0000-4000-b000-000000000003')) = 3);
RESET ROLE;
