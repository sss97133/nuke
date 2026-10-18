-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_movers -f this-file.sql
-- Contract for 20261015173000_family_movers.sql. Synthetic rows only; never production.
-- treemap_family_movers lists the named families whose Bring a Trailer dollars moved most, both ways, with BaT's own
-- move beside them:
--   * a family rises or falls by its BaT dollars, last 12 months over the 12 before; a sale at another venue does not
--     move it;
--   * a family with too few BaT sales in either window, the "other" family, and a family that BaT does not hold half
--     of are not listed;
--   * the BaT totals cover every family, "other" included; eligible and families say how many could be read;
--   * p_limit bounds each direction; anon executes it, PUBLIC does not; the migration applies twice.
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
  ('00000000-0000-4000-b000-000000000002', 'Porsche', 'Boxster', 1997, NULL, '{boxster}'),
  ('00000000-0000-4000-b000-000000000003', 'Porsche', 'Cayenne', 2003, NULL, '{cayenne}'),
  ('00000000-0000-4000-b000-000000000004', 'Porsche', 'Macan', 2014, NULL, '{macan}'),
  ('00000000-0000-4000-b000-000000000005', 'Porsche', 'Cayman', 2005, NULL, '{cayman}'),
  ('00000000-0000-4000-b000-000000000006', 'Porsche', 'Panamera', 2009, NULL, '{panamera}');

-- 911: on BaT 2 sales ($200,000) in the 12 months before, 3 ($400,000) in the last 12, plus a Mecum sale in the window
-- that does not move it. Boxster: 3 ($90,000) then 2 ($40,000). Cayenne: 1 then 5 (too few before). Macan: 2 then 2 on
-- BaT but 6 more undated sales at other venues, so BaT does not hold half of it. Cayman: 2 ($100,000) then 2
-- ($30,000), a steeper fall than the Boxster's. Panamera: 2 ($100,000) then 2 ($120,000), a smaller rise than the
-- 911's. One name with no family (other): 2 then 4 on BaT.
INSERT INTO public.vehicles (id, make, model, sale_date) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Porsche', '911 Carrera', current_date - 400),
  ('00000000-0000-4000-8000-000000000002', 'Porsche', '911 Turbo', current_date - 500),
  ('00000000-0000-4000-8000-000000000003', 'Porsche', '911 GT3', current_date - 30),
  ('00000000-0000-4000-8000-000000000004', 'Porsche', '911 GT3', current_date - 60),
  ('00000000-0000-4000-8000-000000000005', 'Porsche', '911 SC', current_date - 90),
  ('00000000-0000-4000-8000-000000000006', 'Porsche', '911 Turbo', current_date - 20),
  ('00000000-0000-4000-8000-000000000011', 'Porsche', 'Boxster', current_date - 380),
  ('00000000-0000-4000-8000-000000000012', 'Porsche', 'Boxster S', current_date - 420),
  ('00000000-0000-4000-8000-000000000013', 'Porsche', 'Boxster', current_date - 600),
  ('00000000-0000-4000-8000-000000000014', 'Porsche', 'Boxster', current_date - 10),
  ('00000000-0000-4000-8000-000000000015', 'Porsche', 'Boxster S', current_date - 100),
  ('00000000-0000-4000-8000-000000000021', 'Porsche', 'Cayenne', current_date - 450),
  ('00000000-0000-4000-8000-000000000022', 'Porsche', 'Cayenne', current_date - 5),
  ('00000000-0000-4000-8000-000000000023', 'Porsche', 'Cayenne S', current_date - 15),
  ('00000000-0000-4000-8000-000000000024', 'Porsche', 'Cayenne', current_date - 25),
  ('00000000-0000-4000-8000-000000000025', 'Porsche', 'Cayenne GTS', current_date - 35),
  ('00000000-0000-4000-8000-000000000026', 'Porsche', 'Cayenne', current_date - 45),
  ('00000000-0000-4000-8000-000000000031', 'Porsche', 'Macan', current_date - 400),
  ('00000000-0000-4000-8000-000000000032', 'Porsche', 'Macan', current_date - 410),
  ('00000000-0000-4000-8000-000000000033', 'Porsche', 'Macan S', current_date - 40),
  ('00000000-0000-4000-8000-000000000034', 'Porsche', 'Macan S', current_date - 50),
  ('00000000-0000-4000-8000-000000000035', 'Porsche', 'Macan', NULL),
  ('00000000-0000-4000-8000-000000000036', 'Porsche', 'Macan', NULL),
  ('00000000-0000-4000-8000-000000000037', 'Porsche', 'Macan', NULL),
  ('00000000-0000-4000-8000-000000000038', 'Porsche', 'Macan', NULL),
  ('00000000-0000-4000-8000-000000000039', 'Porsche', 'Macan', NULL),
  ('00000000-0000-4000-8000-000000000040', 'Porsche', 'Macan', NULL),
  ('00000000-0000-4000-8000-000000000041', 'Porsche', 'Speedster replica', current_date - 390),
  ('00000000-0000-4000-8000-000000000042', 'Porsche', 'Speedster replica', current_date - 395),
  ('00000000-0000-4000-8000-000000000043', 'Porsche', 'Speedster replica', current_date - 7),
  ('00000000-0000-4000-8000-000000000044', 'Porsche', 'Speedster replica', current_date - 8),
  ('00000000-0000-4000-8000-000000000045', 'Porsche', 'Speedster replica', current_date - 9),
  ('00000000-0000-4000-8000-000000000046', 'Porsche', 'Speedster replica', current_date - 11),
  ('00000000-0000-4000-8000-000000000051', 'Porsche', 'Cayman', current_date - 400),
  ('00000000-0000-4000-8000-000000000052', 'Porsche', 'Cayman S', current_date - 450),
  ('00000000-0000-4000-8000-000000000053', 'Porsche', 'Cayman', current_date - 20),
  ('00000000-0000-4000-8000-000000000054', 'Porsche', 'Cayman S', current_date - 25),
  ('00000000-0000-4000-8000-000000000061', 'Porsche', 'Panamera', current_date - 420),
  ('00000000-0000-4000-8000-000000000062', 'Porsche', 'Panamera S', current_date - 430),
  ('00000000-0000-4000-8000-000000000063', 'Porsche', 'Panamera', current_date - 50),
  ('00000000-0000-4000-8000-000000000064', 'Porsche', 'Panamera S', current_date - 55);
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount, source_name)
SELECT v.id, 'Porsche', v.model,
       CASE WHEN v.model LIKE '911%' THEN 1990 WHEN v.model LIKE 'Boxster%' THEN 2005 WHEN v.model LIKE 'Cayenne%' THEN 2010
            WHEN v.model LIKE 'Macan%' THEN 2018 WHEN v.model LIKE 'Cayman%' THEN 2010 WHEN v.model LIKE 'Panamera%' THEN 2015 ELSE 1990 END,
       'sold',
       CASE v.id
         WHEN '00000000-0000-4000-8000-000000000001' THEN 100000 WHEN '00000000-0000-4000-8000-000000000002' THEN 100000
         WHEN '00000000-0000-4000-8000-000000000003' THEN 150000 WHEN '00000000-0000-4000-8000-000000000004' THEN 150000
         WHEN '00000000-0000-4000-8000-000000000005' THEN 100000 WHEN '00000000-0000-4000-8000-000000000006' THEN 300000
         WHEN '00000000-0000-4000-8000-000000000011' THEN 30000 WHEN '00000000-0000-4000-8000-000000000012' THEN 30000
         WHEN '00000000-0000-4000-8000-000000000013' THEN 30000 WHEN '00000000-0000-4000-8000-000000000014' THEN 20000
         WHEN '00000000-0000-4000-8000-000000000015' THEN 20000 WHEN '00000000-0000-4000-8000-000000000033' THEN 40000
         WHEN '00000000-0000-4000-8000-000000000034' THEN 40000 WHEN '00000000-0000-4000-8000-000000000051' THEN 50000
         WHEN '00000000-0000-4000-8000-000000000052' THEN 50000 WHEN '00000000-0000-4000-8000-000000000053' THEN 15000
         WHEN '00000000-0000-4000-8000-000000000054' THEN 15000 WHEN '00000000-0000-4000-8000-000000000061' THEN 50000
         WHEN '00000000-0000-4000-8000-000000000062' THEN 50000 WHEN '00000000-0000-4000-8000-000000000063' THEN 60000
         WHEN '00000000-0000-4000-8000-000000000064' THEN 60000 ELSE 25000 END,
       CASE WHEN v.id = '00000000-0000-4000-8000-000000000006' THEN 'Mecum'
            WHEN v.model = 'Macan' AND v.sale_date IS NULL THEN 'Mecum' ELSE 'Bring a Trailer' END
FROM public.vehicles v;

\ir helpers/treemap_refresh_all_live_20261015.sql
\ir ../migrations/20261015060000_brand_market_fold.sql
\ir ../migrations/20261015090000_model_family_names.sql
\ir ../migrations/20261015131500_family_market_fold.sql
\ir ../migrations/20261015173000_family_movers.sql
\ir ../migrations/20261015173000_family_movers.sql

CREATE TEMP VIEW mv AS SELECT * FROM public.treemap_family_movers(8, 2);

SELECT pg_temp.ok('the 911 rises by its BaT dollars, and the Mecum sale in the window does not move it',
  (SELECT direction = 'up' AND sold_12m = 3 AND sold_prior_12m = 2 AND usd_12m = 400000 AND usd_prior_12m = 200000
     FROM mv WHERE family = '911'));
SELECT pg_temp.ok('the Boxster falls',
  (SELECT direction = 'down' AND sold_12m = 2 AND sold_prior_12m = 3 AND usd_12m = 40000 AND usd_prior_12m = 90000
     FROM mv WHERE family = 'Boxster'));
SELECT pg_temp.ok('too few BaT sales before, BaT holding under half, and "other" are not listed',
  NOT EXISTS (SELECT 1 FROM mv WHERE family IN ('Cayenne', 'Macan') OR family_key = 'other' OR family IS NULL));
SELECT pg_temp.ok('BaT overall covers every family, other included; eligible and families count what could be read',
  (SELECT bool_and(bat_sold_12m = 3 + 2 + 5 + 2 + 2 + 2 + 4 AND bat_sold_prior_12m = 2 + 3 + 1 + 2 + 2 + 2 + 2
                   AND eligible = 4 AND families = 6) FROM mv));
SELECT pg_temp.ok('risers first, largest move first; p_limit bounds each direction',
  (SELECT array_agg(family ORDER BY n) FROM (SELECT family, row_number() OVER () n FROM mv) x) = ARRAY['911', 'Panamera', 'Cayman', 'Boxster']
  AND (SELECT array_agg(family ORDER BY direction DESC) FROM public.treemap_family_movers(1, 2)) = ARRAY['911', 'Cayman']
  AND NOT EXISTS (SELECT 1 FROM public.treemap_family_movers(8, 30)));
SELECT pg_temp.ok('PUBLIC cannot execute it; anon can',
  NOT has_function_privilege('public', 'public.treemap_family_movers(integer,integer)', 'execute')
  AND has_function_privilege('anon', 'public.treemap_family_movers(integer,integer)', 'execute'));
