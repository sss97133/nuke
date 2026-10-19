-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_dedup_treemap_family_sales_images_and_mecum -f this-file.sql (from supabase/sql)
-- Contract for 20261018150000_dedup_treemap_family_sales_images_and_mecum.sql. Synthetic rows only; never production.
\set ON_ERROR_STOP on
\ir test_dedup_sales_silverado_and_strip_speed_aliases.sql
\ir ../migrations/20261018150000_dedup_treemap_family_sales_images_and_mecum.sql

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('aebc65e7-9760-4936-b6c3-b5233d079df4', 'Chevrolet', 'Chevelle', 1964, 1977,
   ARRAY['chevelle', 'chevelle malibu', 'chevelle custom'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.vehicles (id, year, make, model, sale_date, listing_title, primary_image_url, mileage, vin, listing_url, discovery_url, is_public) VALUES
  -- Two distinct Mecum Kissimmee 2026 lots on adjacent days with their own photos ($203,500) -> both kept
  ('00000000-0000-4000-8000-000000000301', 1965, 'Chevrolet', 'Chevelle', '2026-01-16',
   '1965 Chevrolet Chevelle Custom', 'https://img.example/mecum-1162540.jpg', 1200, '138375Z100001',
   'https://mecum.com/lots/1162540/1965-chevrolet-chevelle', NULL, true),
  ('00000000-0000-4000-8000-000000000302', 1965, 'Chevrolet', 'Chevelle', '2026-01-17',
   '1965 Chevrolet Chevelle Resto Mod', 'https://img.example/mecum-1163056.jpg', 850, '138375Z100002',
   'https://mecum.com/lots/1163056/1965-chevrolet-chevelle', NULL, true),
  -- Adjacent-day Mecum duplicate with NO VIN and NO photo ($203,500) -> dropped in favor of populated sibling
  ('00000000-0000-4000-8000-000000000303', 1965, 'Chevrolet', 'Chevelle', '2026-01-15',
   NULL, NULL, NULL, NULL,
   NULL, 'https://mecum.com/lots/1162540/1965-chevrolet-chevelle', true),
  -- Barrett-Jackson $150,700 1965 Chevelle Malibu (30b54679) vs polluted conceptcarz row (62840c86)
  ('30b54679-0000-4000-8000-000000000304', 1965, 'Chevrolet', 'Chevelle Malibu', '2025-01-25',
   '1965 Chevrolet Chevelle Malibu', 'https://img.example/bj-1965-malibu.jpg', 5000, '136375Z100004',
   'https://www.barrett-jackson.com/2025-scottsdale/docket/vehicle/1965-chevrolet-chevelle-malibu-280001', NULL, true),
  ('62840c86-ed40-4749-81cd-d072d96aff3c', 1965, 'Chevrolet', 'Chevelle Malibu', '2025-01-25',
   '1965 Chevrolet Chevelle Malibu', 'https://img.example/ccz-1965-malibu.jpg', NULL, NULL,
   'conceptcarz://1965-chevrolet-chevelle', NULL, true),
  -- Barrett-Jackson $286,000 1967 Chevelle Custom (real date vs Jan-1 placeholder sharing same photo)
  ('00000000-0000-4000-8000-000000000305', 1967, 'Chevrolet', 'Chevelle Custom', '2025-01-25',
   '1967 Chevrolet Chevelle Custom', 'https://img.example/bj-1967-chevelle.jpg', 900, '138177Z100005',
   'https://www.barrett-jackson.com/2025-scottsdale/docket/vehicle/1967-chevrolet-chevelle-custom-280002', NULL, true),
  ('00000000-0000-4000-8000-000000000306', 1967, 'Chevrolet', 'Chevelle Custom', '2025-01-01',
   '1967 Chevrolet Chevelle Custom', 'https://img.example/bj-1967-chevelle.jpg?w=800', NULL, NULL,
   NULL, NULL, true);

INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, outcome, sale_basis, sold_amount, source_name) VALUES
  ('00000000-0000-4000-8000-000000000301', 'Chevrolet', 'Chevelle', 1965, 'sold', 'status', 203500, 'Mecum'),
  ('00000000-0000-4000-8000-000000000302', 'Chevrolet', 'Chevelle', 1965, 'sold', 'status', 203500, 'Mecum'),
  ('00000000-0000-4000-8000-000000000303', 'Chevrolet', 'Chevelle', 1965, 'sold', 'status', 203500, 'Mecum'),
  ('30b54679-0000-4000-8000-000000000304', 'Chevrolet', 'Chevelle Malibu', 1965, 'sold', 'status', 150700, 'Barrett-Jackson'),
  ('62840c86-ed40-4749-81cd-d072d96aff3c', 'Chevrolet', 'Chevelle Malibu', 1965, 'sold', 'status', 150700, 'Barrett-Jackson'),
  ('00000000-0000-4000-8000-000000000305', 'Chevrolet', 'Chevelle Custom', 1967, 'sold', 'status', 286000, 'Barrett-Jackson'),
  ('00000000-0000-4000-8000-000000000306', 'Chevrolet', 'Chevelle Custom', 1967, 'sold', 'status', 286000, 'Barrett-Jackson');

REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_sales;

DO $$
DECLARE
  v_rows jsonb;
  v_c_1965_203500 int;
  v_c_1965_150700 int;
  v_c_1967_286000 int;
  v_has_polluted_ccz int;
BEGIN
  v_rows := public.treemap_family_sales('Chevrolet', 'aebc65e7-9760-4936-b6c3-b5233d079df4')->'rows';

  SELECT count(*) INTO v_c_1965_203500
  FROM jsonb_array_elements(v_rows) r
  WHERE (r->>4)::int = 1965 AND (r->>2)::int = 203500;

  SELECT count(*) INTO v_c_1965_150700
  FROM jsonb_array_elements(v_rows) r
  WHERE (r->>4)::int = 1965 AND (r->>2)::int = 150700;

  SELECT count(*) INTO v_c_1967_286000
  FROM jsonb_array_elements(v_rows) r
  WHERE (r->>4)::int = 1967 AND (r->>2)::int = 286000;

  SELECT count(*) INTO v_has_polluted_ccz
  FROM jsonb_array_elements(v_rows) r
  WHERE r->>0 = '62840c86-ed40-4749-81cd-d072d96aff3c';

  IF v_c_1965_203500 <> 2 THEN
    RAISE EXCEPTION 'Expected 2 distinct Mecum lots for 1965 Chevelle $203,500, got %', v_c_1965_203500;
  END IF;

  IF v_c_1965_150700 <> 1 THEN
    RAISE EXCEPTION 'Expected 1 row for 1965 Chevelle $150,700, got %', v_c_1965_150700;
  END IF;

  IF v_c_1967_286000 <> 1 THEN
    RAISE EXCEPTION 'Expected 1 row for 1967 Chevelle $286,000, got %', v_c_1967_286000;
  END IF;

  IF v_has_polluted_ccz <> 0 THEN
    RAISE EXCEPTION 'Expected polluted conceptcarz row 62840c86 to be excluded, got %', v_has_polluted_ccz;
  END IF;
END $$;
