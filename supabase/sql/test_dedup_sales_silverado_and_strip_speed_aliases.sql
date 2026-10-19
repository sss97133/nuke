-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_silverado_dedup -f this-file.sql (from supabase/sql)
-- Contract for 20261018133000_dedup_sales_silverado_and_strip_speed_aliases.sql. Synthetic rows only; never production.
-- Verifies that:
--   1. Generic transmission/body-style aliases ('4 speed', '5 speed', '2 door coupe', etc.) on canonical_models rows
--      such as Chevrolet Bel Air are stripped so 'Corvette 4-Speed', 'Camaro 2 Door Coupe', and 'K1500 Silverado 5-Speed'
--      key to their actual model families rather than Bel Air.
--   2. treemap_family_models and treemap_family_sales for Chevrolet Silverado include C/K Silverado trim rows
--      (e.g. 'C10 Silverado Pickup', 'K20 Silverado 4x4') alongside standalone 'Silverado' rows.
--   3. Discovery/detail duplicate rows sharing the same (sale_date, usd, source, year) collapse into a single rich row
--      in both treemap_family_sales and treemap_sales, and treemap_years / treemap_sales on ('Chevrolet', 'Silverado', 1976)
--      return all 1976 Silverado sales.
\set ON_ERROR_STOP on
\ir test_pickup_umbrella_and_series_aliases.sql

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS year integer,
  ADD COLUMN IF NOT EXISTS listing_title text,
  ADD COLUMN IF NOT EXISTS bat_listing_title text,
  ADD COLUMN IF NOT EXISTS primary_image_url text,
  ADD COLUMN IF NOT EXISTS mileage integer,
  ADD COLUMN IF NOT EXISTS vin text,
  ADD COLUMN IF NOT EXISTS listing_url text,
  ADD COLUMN IF NOT EXISTS discovery_url text,
  ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('00000000-0000-4000-b000-000000000108', 'Chevrolet', 'Bel Air', 1950, 1981,
   ARRAY['bel air', '4 speed', '5 speed', '2 door coupe', 'station wagon', 'coupe', 'sedan']),
  ('00000000-0000-4000-b000-000000000109', 'Chevrolet', 'Silverado', 1975, 2026,
   ARRAY['silverado', 'silverado 1500'])
ON CONFLICT (id) DO NOTHING;

-- Insert synthetic 1976 Silverado rows (including the Mecum lot 1111944 discovery/detail duplicate pair),
-- plus 1976 C10/K20 Silverado trim rows, plus a 1976 Corvette 4-Speed that Bel Air previously hijacked.
INSERT INTO public.vehicles (id, year, make, model, sale_date, listing_title, primary_image_url, mileage, vin, listing_url, discovery_url, is_public) VALUES
  ('00000000-0000-4000-8000-000000000201', 1976, 'Chevrolet', 'Silverado', '2024-01-11',
   '1976 Chevrolet Silverado Pickup', 'https://img.example/yellow-silverado.jpg', 94386, 'CKU146Z128166',
   'https://mecum.com/lots/1111944/1976-chevrolet-silverado-pickup', NULL, true),
  ('00000000-0000-4000-8000-000000000202', 1976, 'Chevrolet', 'Silverado', '2024-01-11',
   NULL, 'https://img.example/yellow-silverado.jpg', 94386, NULL,
   NULL, 'https://mecum.com/lots/1111944/1976-chevrolet-silverado-pickup', true),
  ('00000000-0000-4000-8000-000000000203', 1976, 'Chevrolet', 'Silverado', '2024-04-04',
   '1976 Chevrolet Silverado Camper Special Pickup', 'https://img.example/camper-silverado.jpg', 66625, 'CCL246Z100001',
   'https://mecum.com/lots/1120000/1976-chevrolet-silverado-camper', NULL, true),
  ('00000000-0000-4000-8000-000000000204', 1976, 'Chevrolet', 'Silverado Pickup', '2025-02-10',
   '1976 Chevrolet Silverado Pickup', 'https://img.example/silverado-pickup.jpg', 55000, 'CCL146Z100002',
   'https://bringatrailer.com/listing/1976-chevrolet-silverado-pickup/', NULL, true),
  ('00000000-0000-4000-8000-000000000205', 1976, 'Chevrolet', 'C10 Silverado Pickup', '2024-11-20',
   '1976 Chevrolet C10 Silverado Pickup', 'https://img.example/c10-silverado.jpg', 34000, 'CCL146Z100003',
   'https://bringatrailer.com/listing/1976-chevrolet-c10-silverado/', NULL, true),
  ('00000000-0000-4000-8000-000000000206', 1976, 'Chevrolet', 'K20 Silverado 4x4', '2025-10-07',
   '1976 Chevrolet K20 Silverado 4x4', 'https://img.example/k20-silverado.jpg', 14000, 'CKL246Z100004',
   'https://bringatrailer.com/listing/1976-chevrolet-k20-silverado/', NULL, true),
  ('00000000-0000-4000-8000-000000000207', 1976, 'Chevrolet', 'Corvette 4-Speed', '2025-05-01',
   '1976 Chevrolet Corvette 4-Speed', 'https://img.example/corvette-4spd.jpg', 42000, '1Z37L6S400001',
   'https://bringatrailer.com/listing/1976-chevrolet-corvette-4-speed/', NULL, true),
  ('00000000-0000-4000-8000-000000000208', 1957, 'Chevrolet', 'Bel Air', '2025-06-01',
   '1957 Chevrolet Bel Air', 'https://img.example/57-belair.jpg', 12000, 'VC57000001',
   'https://bringatrailer.com/listing/1957-chevrolet-bel-air/', NULL, true),
  ('00000000-0000-4000-8000-000000000209', 1956, 'Chevrolet', 'Bel Air', '2025-06-15',
   '1956 Chevrolet Bel Air', 'https://img.example/56-belair.jpg', 18000, 'VC56000001',
   'https://bringatrailer.com/listing/1956-chevrolet-bel-air/', NULL, true),
  ('00000000-0000-4000-8000-000000000210', 1955, 'Chevrolet', 'Bel Air', '2025-06-20',
   '1955 Chevrolet Bel Air', 'https://img.example/55-belair.jpg', 21000, 'VC55000001',
   'https://bringatrailer.com/listing/1955-chevrolet-bel-air/', NULL, true);

INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sale_basis, sold_amount, source_name) VALUES
  ('00000000-0000-4000-8000-000000000201', 'Chevrolet', 'Silverado', 1976, 'sold', 'status', 24200, 'Mecum'),
  ('00000000-0000-4000-8000-000000000202', 'Chevrolet', 'Silverado', 1976, 'sold', 'status', 24200, 'Mecum'),
  ('00000000-0000-4000-8000-000000000203', 'Chevrolet', 'Silverado', 1976, 'sold', 'status', 12100, 'Mecum'),
  ('00000000-0000-4000-8000-000000000204', 'Chevrolet', 'Silverado Pickup', 1976, 'sold', 'status', 44000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000205', 'Chevrolet', 'C10 Silverado Pickup', 1976, 'sold', 'status', 10650, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000206', 'Chevrolet', 'K20 Silverado 4x4', 1976, 'sold', 'status', 35000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000207', 'Chevrolet', 'Corvette 4-Speed', 1976, 'sold', 'status', 28000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000208', 'Chevrolet', 'Bel Air', 1957, 'sold', 'status', 75000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000209', 'Chevrolet', 'Bel Air', 1956, 'sold', 'status', 68000, 'Bring a Trailer'),
  ('00000000-0000-4000-8000-000000000210', 'Chevrolet', 'Bel Air', 1955, 'sold', 'status', 62000, 'Bring a Trailer');

REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('before: Corvette 4-Speed was hijacked by Bel Air''s 2-word 4 speed alias',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'corvette 4-speed') = 'Bel Air');

\ir ../migrations/20261018133000_dedup_sales_silverado_and_strip_speed_aliases.sql
DROP TABLE IF EXISTS once_aliases_1330;
CREATE TEMP TABLE once_aliases_1330 AS SELECT id, aliases FROM public.canonical_models;
\ir ../migrations/20261018133000_dedup_sales_silverado_and_strip_speed_aliases.sql

REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_sales;

SELECT pg_temp.ok('after: Corvette 4-Speed keys to Corvette instead of Bel Air',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'corvette 4-speed') = 'Corvette'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'bel air') = 'Bel Air');

SELECT pg_temp.ok('after: treemap_family_models and treemap_family_sales on Chevrolet Silverado include C10/K20 Silverado trim rows and deduplicate the 2024-01-11 $24,200 Mecum pair',
  (SELECT count(*) FROM public.treemap_family_models('Chevrolet', '00000000-0000-4000-b000-000000000109')) = 4
  AND (SELECT (public.treemap_family_sales('Chevrolet', '00000000-0000-4000-b000-000000000109')->>'n')::int) = 5);

SELECT pg_temp.ok('after: treemap_sales on (Chevrolet, Silverado, 1976) returns all 5 unique 1976 Silverado sales and keeps the rich row with listing_title',
  (SELECT count(*) FROM public.treemap_sales('Chevrolet', 'Silverado', 1976)) = 5
  AND (SELECT listing_title FROM public.treemap_sales('Chevrolet', 'Silverado', 1976) WHERE sold_amount = 24200) = '1976 Chevrolet Silverado Pickup');

SELECT pg_temp.ok('after: treemap_years on (null, Chevrolet, Silverado) aggregates all 1976 Silverado rows',
  (SELECT count FROM public.treemap_years(NULL, 'Chevrolet', 'Silverado') WHERE name = '1976') = 6);

SELECT pg_temp.ok('a second apply of 20261018133000 changes nothing',
  NOT EXISTS (
    SELECT 1
    FROM public.canonical_models m
    JOIN once_aliases_1330 o USING (id)
    WHERE m.aliases IS DISTINCT FROM o.aliases
  ));
