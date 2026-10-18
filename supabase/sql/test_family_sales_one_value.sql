-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_sales -f this-file.sql (from supabase/sql)
-- Contract for 20261015234500_family_sales_one_value.sql. Synthetic rows only; never production.
-- Runs the whole family-sales contract, then the change twice, and requires:
--   * treemap_family_sales returns one jsonb: n in the five-year window, returned, truncated, window_from, and rows
--     newest first as [vehicle_id, sale_date, usd, source, year, model];
--   * a limit returns the newest rows and says it truncated; more than 1,000 rows come back in the one value;
--   * PUBLIC cannot execute it; anon can.
\set ON_ERROR_STOP on
\ir test_family_sales_fold.sql

\ir ../migrations/20261015234500_family_sales_one_value.sql
\ir ../migrations/20261015234500_family_sales_one_value.sql

-- The 911 family after the base contract: 11 (5 days ago), 01 (30), 02 (400), 03 (900); 04 is 2,200 days old.
CREATE TEMP TABLE r911 AS SELECT public.treemap_family_sales('Porsche', '00000000-0000-4000-b000-000000000001') AS j;
SELECT pg_temp.ok('one jsonb with the window''s count, newest first, every row of the window',
  (SELECT pg_get_function_result('public.treemap_family_sales(text,text,integer)'::regprocedure)) = 'jsonb'
  AND (SELECT (j->>'n')::int = 4 AND (j->>'returned')::int = 4 AND (j->>'truncated')::boolean = false
         AND (j->>'window_from')::date = current_date - 1825 FROM r911)
  AND (SELECT array_agg(right(e->>0, 2) ORDER BY o) FROM r911, jsonb_array_elements(j->'rows') WITH ORDINALITY a(e, o))
      = ARRAY['11', '01', '02', '03']);
SELECT pg_temp.ok('a row is [vehicle_id, sale_date, usd, source, year, model]',
  (SELECT e FROM r911, jsonb_array_elements(j->'rows') e WHERE right(e->>0, 2) = '03')
    = jsonb_build_array('00000000-0000-4000-8000-000000000003'::uuid, current_date - 900, 80000, 'Mecum', 1972, '911 Targa'));
SELECT pg_temp.ok('a limit returns the newest and says the window holds more',
  (SELECT (j->>'n')::int = 4 AND (j->>'returned')::int = 1 AND (j->>'truncated')::boolean
          AND right(j->'rows'->0->>0, 2) = '11' AND jsonb_array_length(j->'rows') = 1
   FROM (SELECT public.treemap_family_sales('Porsche', '00000000-0000-4000-b000-000000000001', 1) j) x));
SELECT pg_temp.ok('a family with no sale in the window returns n 0 and no rows',
  (SELECT (j->>'n')::int = 0 AND j->'rows' = '[]'::jsonb
   FROM (SELECT public.treemap_family_sales('Porsche', '00000000-0000-4000-b000-00000000ffff') j) x));
SELECT pg_temp.ok('PUBLIC cannot execute the reader; anon can',
  NOT has_function_privilege('public', 'public.treemap_family_sales(text,text,integer)', 'execute')
  AND has_function_privilege('anon', 'public.treemap_family_sales(text,text,integer)', 'execute'));

-- 1,500 more dated 911 sales: one value carries all of them (the API caps a set at 1,000 rows, not a value).
INSERT INTO public.vehicles (id, make, model, sale_date)
  SELECT ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, 'Porsche', '911 Carrera', current_date - 1 - (i % 1700)
  FROM generate_series(1, 1500) i;
INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount, source_name)
  SELECT ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, 'Porsche', '911 Carrera', 1990, 'sold', 50000 + i, 'Bring a Trailer'
  FROM generate_series(1, 1500) i;
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_sales;
SELECT pg_temp.ok('1,504 sales in the window come back whole in one value, newest first',
  (SELECT (j->>'n')::int = 1504 AND (j->>'returned')::int = 1504 AND jsonb_array_length(j->'rows') = 1504
          AND (j->'rows'->0->>1)::date >= (j->'rows'->1503->>1)::date
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'rows') WITH ORDINALITY a(e, o)
                          JOIN jsonb_array_elements(j->'rows') WITH ORDINALITY b(e, o) ON b.o = a.o + 1
                          WHERE (a.e->>1)::date < (b.e->>1)::date)
   FROM (SELECT public.treemap_family_sales('Porsche', '00000000-0000-4000-b000-000000000001') j) x));
