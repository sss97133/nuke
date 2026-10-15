-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_brand_market -f this-file.sql
-- Contract for 20261015060000_brand_market_fold.sql. Synthetic rows only; never production.
-- mv_treemap_outcomes (here a table with its columns) and vehicles' sale dates feed mv_brand_market:
--   * a 30-sale brand: sold, offered, sell-through, dollars, the p10/p50/p90 band, the model year that trades, and the
--     last 12 months against the 12 before, each equal to its hand computation;
--   * a 7-sale brand gets a median but no band (under 20 sales); a 4-sale brand is left out (under 5);
--   * anon reads it through treemap_brand_market(), largest market first; it refreshes CONCURRENTLY; the treemap
--     refresh includes it; the migration is idempotent.
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

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, sale_date date, bat_sale_date date);
-- mv_treemap_outcomes' columns (pg_attribute, 2026-10-15).
CREATE TABLE public.mv_treemap_outcomes (id uuid PRIMARY KEY, brand_name text, model text, year integer, source_name text,
  outcome text, sale_basis text, sold_amount numeric, bat_bids integer, bat_watchers integer);
\ir helpers/treemap_refresh_all_live_20261015.sql

-- Brand Alpha: 30 sold at 1,000 .. 30,000 and 10 unsold. Model years 1960 + g (g = 1..30). Sale dates: g 1..10 in the
-- last 12 months (sale_date), g 11..18 in the 12 before (bat_sale_date only), g 19..25 older, g 26..30 undated.
INSERT INTO public.vehicles (id, sale_date, bat_sale_date)
SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       CASE WHEN g <= 10 THEN current_date - (g * 30) WHEN g BETWEEN 19 AND 25 THEN current_date - 900 END,
       CASE WHEN g BETWEEN 11 AND 18 THEN current_date - 400 - g END
FROM generate_series(1, 40) g;
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount)
SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Alpha', 'A', 1960 + g,
       CASE WHEN g <= 30 THEN 'sold' ELSE 'not_sold' END,
       CASE WHEN g <= 30 THEN g * 1000 END
FROM generate_series(1, 40) g;
-- Brand Beta: 7 sold at 100,000 .. 700,000. Brand Gamma: 4 sold.
INSERT INTO public.vehicles (id) SELECT ('00000000-0000-4000-8001-' || lpad(g::text, 12, '0'))::uuid FROM generate_series(1, 11) g;
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount)
SELECT ('00000000-0000-4000-8001-' || lpad(g::text, 12, '0'))::uuid,
       CASE WHEN g <= 7 THEN 'Beta' ELSE 'Gamma' END, 'B', 1990, 'sold',
       CASE WHEN g <= 7 THEN g * 100000 ELSE 5000 END
FROM generate_series(1, 11) g;

\ir ../migrations/20261015060000_brand_market_fold.sql
-- A second application changes nothing and passes its own guard and checks.
\ir ../migrations/20261015060000_brand_market_fold.sql

SELECT pg_temp.ok('Alpha: sold 30, offered 40, sell-through 75%, dollars 465,000',
  (SELECT sold = 30 AND sold_any = 30 AND offered = 40 AND usd = 465000 FROM public.mv_brand_market WHERE name = 'Alpha'));
SELECT pg_temp.ok('Alpha: band p10 3,900, p50 15,500, p90 27,100 (percentile_cont over 1,000 .. 30,000)',
  (SELECT p10 = 3900 AND p50 = 15500 AND p90 = 27100 FROM public.mv_brand_market WHERE name = 'Alpha'));
SELECT pg_temp.ok('Alpha: the model year that trades is 1975 (percentile_disc over 1961 .. 1990)',
  (SELECT year_p50 = 1975 FROM public.mv_brand_market WHERE name = 'Alpha'));
SELECT pg_temp.ok('Alpha: 25 dated sales; 10 in the last 12 months, 8 in the 12 before; their dollars',
  (SELECT dated = 25 AND sold_12m = 10 AND sold_prior_12m = 8 AND usd_12m = 55000 AND usd_prior_12m = 116000
   FROM public.mv_brand_market WHERE name = 'Alpha'));
SELECT pg_temp.ok('Beta: 7 sales get a median and no band; Gamma (4 sales) is left out',
  (SELECT p50 = 400000 AND p10 IS NULL AND p90 IS NULL FROM public.mv_brand_market WHERE name = 'Beta')
  AND NOT EXISTS (SELECT 1 FROM public.mv_brand_market WHERE name = 'Gamma'));

SET ROLE anon;
SELECT pg_temp.ok('anon reads it through treemap_brand_market(), largest market first',
  (SELECT array_agg(name) FROM public.treemap_brand_market()) = ARRAY['Beta', 'Alpha']);
RESET ROLE;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brand_market;
SELECT pg_temp.ok('refreshes concurrently and the treemap refresh includes it',
  (SELECT count(*) FROM public.mv_brand_market) = 2
  AND position('mv_brand_market' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.treemap_refresh_all()'::regprocedure)) > 0);
