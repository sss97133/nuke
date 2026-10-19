-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_measured_houses -f this-file.sql (from supabase/sql)
-- Contract for 20261018120000_measured_houses_market_fold.sql. Synthetic rows only; never production.
-- Verifies that mv_family_market, treemap_brand_market, treemap_brand_families, treemap_family_models,
-- treemap_family_monthly, and mv_family_share_movers include all three auction houses held in full both years
-- (Bring a Trailer, Mecum, Bonhams) while excluding unmeasured houses (e.g. Gooding & Co), and that the
-- migration is idempotent when applied twice.
\set ON_ERROR_STOP on
\ir test_family_monthly_bins.sql

-- Add a Bonhams sale in the prior 12-month window so all three measured houses (Bring a Trailer, Mecum, Bonhams) are represented.
INSERT INTO public.vehicles (id, make, model, sale_date) VALUES
  ('00000000-0000-4000-8000-000000000022', 'Porsche', '911 Carrera', current_date - 500);
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount, source_name) VALUES
  ('00000000-0000-4000-8000-000000000022', 'Porsche', '911 Carrera', 1991, 'sold', 95000, 'Bonhams');

\ir ../migrations/20261018120000_measured_houses_market_fold.sql
\ir ../migrations/20261018120000_measured_houses_market_fold.sql

DROP TABLE IF EXISTS fam;
DROP TABLE IF EXISTS got;

CREATE TEMP TABLE fam AS
  SELECT brand, family_key, sum(bat_dated) AS dated, sum(bat_sold_12m) AS s12, sum(bat_sold_prior_12m) AS sp
  FROM public.mv_family_market WHERE family_key <> 'other' GROUP BY 1, 2;

CREATE TEMP TABLE got AS
  SELECT f->>'brand' AS brand, f->>'family_key' AS family_key, f->'bins' AS bins, o
  FROM jsonb_array_elements((SELECT public.treemap_family_monthly(jsonb_agg(jsonb_build_object('brand', brand, 'family_key', family_key)))
                             FROM fam)->'families') WITH ORDINALITY AS a(f, o);

SELECT pg_temp.ok('mv_family_market counts Bring a Trailer, Mecum, and Bonhams in bat_dated and the 12-month windows',
  (SELECT sp FROM fam WHERE family_key = '00000000-0000-4000-b000-000000000001') =
  (SELECT count(*) FROM public.mv_family_sales
   WHERE family_key = '00000000-0000-4000-b000-000000000001'
     AND source IN ('Bring a Trailer', 'Mecum', 'Bonhams')
     AND sale_date > current_date - 730 AND sale_date <= current_date - 365));

SELECT pg_temp.ok('unmeasured houses (Gooding & Co) stay out of bat_dated on Porsche 356',
  (SELECT dated FROM fam WHERE family_key = '00000000-0000-4000-b000-000000000004') = 1);

SELECT pg_temp.ok('treemap_family_monthly bins sum to mv_family_market s12 and sp across all three measured houses',
  NOT EXISTS (
    SELECT 1 FROM got g JOIN fam f USING (brand, family_key)
    WHERE (SELECT sum(v::int) FROM jsonb_array_elements_text(g.bins) WITH ORDINALITY e(v, i) WHERE i > 12) IS DISTINCT FROM f.s12
       OR (SELECT sum(v::int) FROM jsonb_array_elements_text(g.bins) WITH ORDINALITY e(v, i) WHERE i <= 12) IS DISTINCT FROM f.sp));

SELECT pg_temp.ok('mv_family_market and mv_family_sales refresh concurrently after the migration',
  EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = 'public.mv_family_market'::regclass AND i.indisunique)
  AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = 'public.mv_family_sales'::regclass AND i.indisunique));

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_sales;
