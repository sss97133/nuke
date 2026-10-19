-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_pickup_umbrella -f this-file.sql (from supabase/sql)
-- Contract for 20261018131500_pickup_umbrella_and_series_aliases.sql. Synthetic rows only; never production.
-- Verifies that:
--   1. Series-named custom pickup models ('3100 Custom Pickup', 'Apache Custom Pickup', 'Cameo Custom Pickup',
--      'K20 Custom Pickup', 'K10 Cheyenne Super Custom Pickup', 'Scottsdale K20') key to their respective series
--      families ('3100', 'Apache', 'Cameo', 'K20', 'K10'), while generic 'Pickup' and 'Custom Pickup' key to 'Pickup',
--      and '327/340hp Split Window Coupe' keys to 'Corvette' instead of 'Pickup'.
--   2. treemap_family_models and treemap_family_sales for a brand's umbrella 'Pickup' family aggregate across the
--      brand's pickup series families (e.g. C10, K10, 3100, Pickup) while specific series family_keys (e.g. C10)
--      remain scoped to that series alone.
--   3. Applying the migration a second time is idempotent and changes nothing.
\set ON_ERROR_STOP on
\ir test_measured_houses_market_fold.sql

INSERT INTO public.canonical_makes (id, canonical_name, display_name, short_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000004', 'Chevrolet', 'Chevrolet', 'Chevy', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('00000000-0000-4000-b000-000000000100', 'Chevrolet', 'Pickup', 1918, 2024,
   ARRAY['pickup', 'custom pickup', 'window', '5 window', '5-window', '3 window', '3-window']),
  ('00000000-0000-4000-b000-000000000101', 'Chevrolet', 'Corvette', 1953, 2024,
   ARRAY['corvette', 'stingray']),
  ('00000000-0000-4000-b000-000000000102', 'Chevrolet', '3100', 1947, 1959,
   ARRAY['3100', '3100 pickup']),
  ('00000000-0000-4000-b000-000000000103', 'Chevrolet', 'Apache', 1958, 1961,
   ARRAY['apache', 'apache pickup']),
  ('00000000-0000-4000-b000-000000000104', 'Chevrolet', 'Cameo', 1955, 1958,
   ARRAY['cameo', 'cameo pickup']),
  ('00000000-0000-4000-b000-000000000105', 'Chevrolet', 'C10', 1960, 1987,
   ARRAY['c10', 'c10 pickup']),
  ('00000000-0000-4000-b000-000000000106', 'Chevrolet', 'K10', 1960, 1987,
   ARRAY['k10', 'k10 pickup']),
  ('00000000-0000-4000-b000-000000000107', 'Chevrolet', 'K20', 1960, 1987,
   ARRAY['k20', 'k20 pickup']);

-- 3 Pickup rows, 3 3100 rows, 3 C10 rows, plus Apache, Cameo, K10, K20, and Split Window Corvette
INSERT INTO public.vehicles (id, make, model, sale_date) VALUES
  ('00000000-0000-4000-8000-000000000101', 'Chevrolet', 'Pickup', current_date - 30),
  ('00000000-0000-4000-8000-000000000102', 'Chevrolet', 'Custom Pickup', current_date - 35),
  ('00000000-0000-4000-8000-000000000103', 'Chevrolet', 'Pickup', current_date - 40),
  ('00000000-0000-4000-8000-000000000104', 'Chevrolet', '3100 Custom Pickup', current_date - 45),
  ('00000000-0000-4000-8000-000000000105', 'Chevrolet', '3100 Custom Pickup', current_date - 50),
  ('00000000-0000-4000-8000-000000000106', 'Chevrolet', '3100', current_date - 55),
  ('00000000-0000-4000-8000-000000000107', 'Chevrolet', 'C10', current_date - 60),
  ('00000000-0000-4000-8000-000000000108', 'Chevrolet', 'C10', current_date - 65),
  ('00000000-0000-4000-8000-000000000109', 'Chevrolet', 'C10 Custom Pickup', current_date - 70),
  ('00000000-0000-4000-8000-000000000110', 'Chevrolet', 'Apache Custom Pickup', current_date - 75),
  ('00000000-0000-4000-8000-000000000111', 'Chevrolet', 'Cameo Custom Pickup', current_date - 80),
  ('00000000-0000-4000-8000-000000000112', 'Chevrolet', 'K10 Cheyenne Super Custom Pickup', current_date - 85),
  ('00000000-0000-4000-8000-000000000113', 'Chevrolet', 'Scottsdale K20', current_date - 90),
  ('00000000-0000-4000-8000-000000000114', 'Chevrolet', '327/340hp Split Window Coupe', current_date - 95);

INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sold_amount, source_name) VALUES
  ('00000000-0000-4000-8000-000000000101', 'Chevrolet', 'Pickup', 1978, 'sold', 35000, 'Mecum'),
  ('00000000-0000-4000-8000-000000000102', 'Chevrolet', 'Custom Pickup', 1951, 'sold', 45000, 'Mecum'),
  ('00000000-0000-4000-8000-000000000103', 'Chevrolet', 'Pickup', 1984, 'sold', 32000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000104', 'Chevrolet', '3100 Custom Pickup', 1953, 'sold', 65000, 'Mecum'),
  ('00000000-0000-4000-8000-000000000105', 'Chevrolet', '3100 Custom Pickup', 1954, 'sold', 70000, 'Mecum'),
  ('00000000-0000-4000-8000-000000000106', 'Chevrolet', '3100', 1950, 'sold', 50000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000107', 'Chevrolet', 'C10', 1985, 'sold', 40000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000108', 'Chevrolet', 'C10', 1979, 'sold', 38000, 'Mecum'),
  ('00000000-0000-4000-8000-000000000109', 'Chevrolet', 'C10 Custom Pickup', 1983, 'sold', 42000, 'Mecum'),
  ('00000000-0000-4000-8000-000000000110', 'Chevrolet', 'Apache Custom Pickup', 1959, 'sold', 55000, 'Mecum'),
  ('00000000-0000-4000-8000-000000000111', 'Chevrolet', 'Cameo Custom Pickup', 1957, 'sold', 75000, 'Mecum'),
  ('00000000-0000-4000-8000-000000000112', 'Chevrolet', 'K10 Cheyenne Super Custom Pickup', 1974, 'sold', 52000, 'Mecum'),
  ('00000000-0000-4000-8000-000000000113', 'Chevrolet', 'Scottsdale K20', 1979, 'sold', 38000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000114', 'Chevrolet', '327/340hp Split Window Coupe', 1963, 'sold', 195000, 'Mecum');

REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('before: 3100 Custom Pickup and Split Window Coupe were hijacked by generic Pickup aliases',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = '3100 custom pickup') = 'Pickup'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = '327/340hp split window coupe') = 'Pickup');

\ir ../migrations/20261018131500_pickup_umbrella_and_series_aliases.sql
CREATE TEMP TABLE once_aliases AS SELECT id, aliases FROM public.canonical_models;
\ir ../migrations/20261018131500_pickup_umbrella_and_series_aliases.sql
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_sales;

SELECT pg_temp.ok('after: series custom pickups key to their series families and Split Window Coupe keys to Corvette',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = '3100 custom pickup') = '3100'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'c10 custom pickup') = 'C10'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'apache custom pickup') = 'Apache'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'cameo custom pickup') = 'Cameo'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'k10 cheyenne super custom pickup') = 'K10'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'scottsdale k20') = 'K20'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = '327/340hp split window coupe') = 'Corvette'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'pickup') = 'Pickup'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'custom pickup') = 'Pickup');

SELECT pg_temp.ok('after: treemap_family_models and treemap_family_sales on Chevrolet Pickup aggregate across Pickup + 3100 + C10 while C10 stays scoped to C10',
  (SELECT count(*) FROM public.treemap_family_models('Chevrolet', '00000000-0000-4000-b000-000000000100')) = 6
  AND (SELECT sum(sold) FROM public.treemap_family_models('Chevrolet', '00000000-0000-4000-b000-000000000100')) = 9
  AND (SELECT (public.treemap_family_sales('Chevrolet', '00000000-0000-4000-b000-000000000100')->>'n')::int) = 9
  AND (SELECT count(*) FROM public.treemap_family_models('Chevrolet', '00000000-0000-4000-b000-000000000105')) = 2
  AND (SELECT sum(sold) FROM public.treemap_family_models('Chevrolet', '00000000-0000-4000-b000-000000000105')) = 3
  AND (SELECT (public.treemap_family_sales('Chevrolet', '00000000-0000-4000-b000-000000000105')->>'n')::int) = 3);

SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (
    SELECT 1
    FROM public.canonical_models m
    JOIN once_aliases o USING (id)
    WHERE m.aliases IS DISTINCT FROM o.aliases
  ));
