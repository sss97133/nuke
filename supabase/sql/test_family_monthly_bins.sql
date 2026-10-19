-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_sales -f this-file.sql (from supabase/sql)
-- Contract for 20261016050000_family_monthly_bins.sql. Synthetic rows only; never production.
-- Runs the family-sales chain (its fixture holds BaT, Mecum and Gooding sales, and 1,504 BaT 911 sales spread over 1,700
-- days), applies the change twice, and requires: 24 bins per family, oldest first; the last 12 bins sum to the family's
-- bat_sold_12m and the first 12 to its bat_sold_prior_12m in mv_family_market (same snapshot); other venues and older
-- sales stay out; unknown families read zeros; input order is kept, repeats collapse, 40 at most; anon may execute.
\set ON_ERROR_STOP on
\ir test_family_sales_cluster.sql

-- A BaT 911 sale dated today: the market's 12-month window includes today, so the last bin must too.
INSERT INTO public.vehicles (id, make, model, sale_date) VALUES ('00000000-0000-4000-8000-000000000021', 'Porsche', '911 Carrera', current_date);
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount, source_name) VALUES
  ('00000000-0000-4000-8000-000000000021', 'Porsche', '911 Carrera', 1991, 'sold', 77000, 'Bring a Trailer');
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_sales;

\ir ../migrations/20261016050000_family_monthly_bins.sql
\ir ../migrations/20261016050000_family_monthly_bins.sql

CREATE TEMP TABLE fam AS
  SELECT brand, family_key, sum(bat_sold_12m) AS s12, sum(bat_sold_prior_12m) AS sp
  FROM public.mv_family_market WHERE family_key <> 'other' GROUP BY 1, 2;
CREATE TEMP TABLE got AS
  SELECT f->>'brand' AS brand, f->>'family_key' AS family_key, f->'bins' AS bins, o
  FROM jsonb_array_elements((SELECT public.treemap_family_monthly(jsonb_agg(jsonb_build_object('brand', brand, 'family_key', family_key)))
                             FROM fam)->'families') WITH ORDINALITY AS a(f, o);
SELECT pg_temp.ok('every family reads 24 bins',
  (SELECT count(*) FROM got) = (SELECT count(*) FROM fam) AND (SELECT count(*) FROM fam) >= 3
  AND NOT EXISTS (SELECT 1 FROM got WHERE jsonb_array_length(bins) <> 24));
SELECT pg_temp.ok('the last 12 bins are the family''s BaT sales of the last 365 days, the first 12 the year before (mv_family_market)',
  NOT EXISTS (
    SELECT 1 FROM got g JOIN fam f USING (brand, family_key)
    WHERE (SELECT sum(v::int) FROM jsonb_array_elements_text(g.bins) WITH ORDINALITY e(v, i) WHERE i > 12) IS DISTINCT FROM f.s12
       OR (SELECT sum(v::int) FROM jsonb_array_elements_text(g.bins) WITH ORDINALITY e(v, i) WHERE i <= 12) IS DISTINCT FROM f.sp)
  AND (SELECT sum(s12) FROM fam) > 0 AND (SELECT sum(sp) FROM fam) > 0);
SELECT pg_temp.ok('bins run oldest first: the 911''s sale 5 days old sits in the last bin',
  (SELECT (bins->>23)::int > 0 FROM got WHERE family_key = '00000000-0000-4000-b000-000000000001'));
SELECT pg_temp.ok('other venues and sales older than two years stay out',
  (SELECT sum(v::int) FROM got, jsonb_array_elements_text(bins) v WHERE family_key = '00000000-0000-4000-b000-000000000001')
    = (SELECT count(*) FROM public.mv_family_sales WHERE family_key = '00000000-0000-4000-b000-000000000001'
         AND source = 'Bring a Trailer' AND sale_date > current_date - 730 AND sale_date <= current_date)
  AND (SELECT count(*) FROM public.mv_family_sales WHERE family_key = '00000000-0000-4000-b000-000000000001'
         AND (source <> 'Bring a Trailer' OR sale_date <= current_date - 730)) > 0);
SELECT pg_temp.ok('an unknown family reads 24 zeros; input order kept, repeats collapse, 40 at most, bad input reads none',
  (SELECT (j->'families'->0->'bins') = (SELECT jsonb_agg(0) FROM generate_series(1, 24))
          AND j->'families'->1->>'family_key' = '00000000-0000-4000-b000-000000000001'
          AND jsonb_array_length(j->'families') = 2
   FROM (SELECT public.treemap_family_monthly('[{"brand":"Porsche","family_key":"none"},{"brand":"Porsche","family_key":"00000000-0000-4000-b000-000000000001"},{"brand":"Porsche","family_key":"none"}]'::jsonb) j) x)
  AND (SELECT jsonb_array_length(public.treemap_family_monthly(
         (SELECT jsonb_agg(jsonb_build_object('brand', 'B', 'family_key', 'f' || i)) FROM generate_series(1, 50) i))->'families')) = 40
  AND (SELECT public.treemap_family_monthly('{"not":"an array"}'::jsonb)->'families') = '[]'::jsonb);
SELECT pg_temp.ok('PUBLIC cannot execute the reader; anon can',
  NOT has_function_privilege('public', 'public.treemap_family_monthly(jsonb)', 'execute')
  AND has_function_privilege('anon', 'public.treemap_family_monthly(jsonb)', 'execute'));
