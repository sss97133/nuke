-- Empty disposable PG17 dm_refinement_* database only; synthetic rows.
-- Contract for 20261021002000_search_vehicles_browse_deleted_rows_and_sale_basis.sql: search_vehicles_browse leaves
-- deleted records and non-vehicle items out of every page and total, prints a row's sale basis (sale_status 'sold'
-- with sale_price) as sold_price before the legacy column, sorts and bounds prices on the same expression, keeps every
-- other filter, applies twice, and keeps its grants.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

-- vehicles with every column the reader reads.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, vin text, status text, source text, sold_price integer,
  sale_price integer, sale_status text, deleted_at timestamptz, listing_kind text,
  primary_image_url text, era text, body_style text, exterior_color text, created_at timestamptz DEFAULT now(),
  is_public boolean, canonical_vehicle_type text
);
CREATE INDEX idx_vehicles_created_at ON public.vehicles USING btree (created_at);
CREATE INDEX idx_vehicles_lower_make_model ON public.vehicles USING btree (lower(make), lower(model));

-- Eight Carrera GTs as production shows them (2026-10-20): house records with a sale basis, a legacy-only price,
-- both, neither, a deleted February stub that is still public, a deleted house record, a non-vehicle item, a private row.
INSERT INTO public.vehicles (id, year, make, model, vin, status, source, sold_price, sale_price, sale_status, deleted_at, listing_kind, primary_image_url, is_public, canonical_vehicle_type, created_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 2005, 'Porsche', 'Carrera GT', 'WP0CA29825L001001', 'sold', 'gooding',  NULL,    1900000, 'sold',      NULL, NULL, 'https://img.test/1.jpg', true, 'CAR', timestamptz '2026-02-02'),
  ('00000000-0000-4000-8000-000000000002', 2004, 'Porsche', 'Carrera GT', 'WP0CA29824L001002', 'sold', 'mecum',    1200000, NULL,    'available', NULL, NULL, 'https://img.test/2.jpg', true, 'CAR', timestamptz '2026-01-25'),
  ('00000000-0000-4000-8000-000000000003', 2005, 'Porsche', 'Carrera GT', 'WP0CA29825L001003', 'sold', 'bat',      1500000, 1870000, 'sold',      NULL, NULL, 'https://img.test/3.jpg', true, 'CAR', timestamptz '2026-03-01'),
  ('00000000-0000-4000-8000-000000000004', 2005, 'Porsche', 'Carrera GT', NULL,                'active', 'classic-driver', NULL, NULL, 'available', NULL, NULL, NULL,                  true, NULL,  timestamptz '2026-03-26'),
  ('00000000-0000-4000-8000-000000000005', NULL, 'Porsche', 'Carrera GT', NULL,                'discovered', 'unknown', NULL, NULL,  'available', timestamptz '2026-03-10', NULL, NULL, true, NULL, timestamptz '2026-02-15'),
  ('00000000-0000-4000-8000-000000000006', 2005, 'Porsche', 'Carrera GT', 'WP0CA29825L001006', 'sold', 'rm-sothebys', NULL, 1650000, 'sold',      timestamptz '2026-03-21', NULL, 'https://img.test/6.jpg', true, 'CAR', timestamptz '2026-02-02'),
  ('00000000-0000-4000-8000-000000000007', 2005, 'Porsche', 'Carrera GT', NULL,                'active', 'ebay_motors', NULL, 25000, 'sold',     NULL, 'non_vehicle_item', 'https://img.test/7.jpg', true, 'CAR', timestamptz '2026-10-01'),
  ('00000000-0000-4000-8000-000000000008', 2005, 'Porsche', 'Carrera GT', 'WP0CA29825L001008', 'sold', 'bonhams',  NULL,    1400000, 'sold',      NULL, NULL, 'https://img.test/8.jpg', false, 'CAR', timestamptz '2026-02-06');
-- A sale-status row with sale_price 0 keeps its legacy price (the basis needs an amount); an unrelated make.
INSERT INTO public.vehicles (id, year, make, model, status, source, sold_price, sale_price, sale_status, is_public, canonical_vehicle_type, created_at) VALUES
  ('00000000-0000-4000-8000-000000000009', 1973, 'Porsche', '911', 'sold', 'bat', 95000, 0, 'sold', true, 'CAR', timestamptz '2026-04-01');
ANALYZE public.vehicles;

-- The reader as it was: the 2026-10-14 live helper, then the 2026-10-14 migration that this one replays over.
\ir helpers/search_vehicles_browse_live_20261014.sql
\ir ../migrations/20261014111500_search_vehicles_browse_newest_from_index.sql
-- The migration under test, twice (the second run finds its own source and replaces it unchanged).
\ir ../migrations/20261021002000_search_vehicles_browse_deleted_rows_and_sale_basis.sql
\ir ../migrations/20261021002000_search_vehicles_browse_deleted_rows_and_sale_basis.sql

CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN ASSERT ok IS TRUE, label; END $$;
CREATE TEMP TABLE page AS
  SELECT t.* FROM public.search_vehicles_browse(p_make => 'porsche', p_model => 'carrera gt', p_sort_by => 'sold_price', p_sort_dir => 'desc', p_page => 1, p_page_size => 50)
  WITH ORDINALITY AS t(id, year, make, model, vin, status, source, sold_price, primary_image_url, era, body_style, total_count, ord);

SELECT pg_temp.check((SELECT count(*) = 4 FROM page), 'four live Carrera GTs: the deleted stub, the deleted house record, the non-vehicle item and the private row are out');
SELECT pg_temp.check((SELECT min(total_count) = 4 AND max(total_count) = 4 FROM page), 'the total counts the same four');
SELECT pg_temp.check((SELECT NOT EXISTS (SELECT 1 FROM page WHERE id IN ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000008'))), 'no deleted, non-vehicle or private id on the page');
SELECT pg_temp.check((SELECT sold_price = 1900000 FROM page WHERE id = '00000000-0000-4000-8000-000000000001'), 'a sale basis prints as sold_price');
SELECT pg_temp.check((SELECT sold_price = 1200000 FROM page WHERE id = '00000000-0000-4000-8000-000000000002'), 'a legacy price stays when there is no sale basis');
SELECT pg_temp.check((SELECT sold_price = 1870000 FROM page WHERE id = '00000000-0000-4000-8000-000000000003'), 'the sale basis outranks a different legacy price');
SELECT pg_temp.check((SELECT sold_price IS NULL FROM page WHERE id = '00000000-0000-4000-8000-000000000004'), 'no price prints as null, never 0');
SELECT pg_temp.check((SELECT array_agg(right(id::text, 1) ORDER BY ord) = ARRAY['1', '3', '2', '4'] FROM page), 'PRICE HIGH orders by the printed price, nulls last');
SELECT pg_temp.check((SELECT array_agg(right(id::text, 1) ORDER BY ord) = ARRAY['2', '3', '1', '4'] FROM public.search_vehicles_browse(p_make => 'Porsche', p_model => 'Carrera GT', p_sort_by => 'sold_price', p_sort_dir => 'asc') WITH ORDINALITY AS t(id, year, make, model, vin, status, source, sold_price, primary_image_url, era, body_style, total_count, ord)), 'PRICE LOW orders the same expression ascending, nulls last');
SELECT pg_temp.check((SELECT count(*) = 3 AND bool_and(sold_price > 0) FROM public.search_vehicles_browse(p_make => 'Porsche', p_model => 'Carrera GT', p_has_price => true)), 'p_has_price counts the sale basis and the legacy price');
SELECT pg_temp.check((SELECT count(*) = 2 FROM public.search_vehicles_browse(p_make => 'Porsche', p_model => 'Carrera GT', p_price_min => 1500000)), 'a price floor reads the same expression');
SELECT pg_temp.check((SELECT count(*) = 1 AND min(sold_price) = 1200000 FROM public.search_vehicles_browse(p_make => 'Porsche', p_model => 'Carrera GT', p_price_max => 1500000)), 'a price ceiling reads the same expression');
SELECT pg_temp.check((SELECT sold_price = 95000 FROM public.search_vehicles_browse(p_make => 'Porsche', p_model => '911')), 'sale_status sold with no amount keeps the legacy price');
SELECT pg_temp.check((SELECT count(*) = 5 FROM public.search_vehicles_browse(p_sort_by => 'newest')), 'a created_at page leaves deleted rows and non-vehicle items out too');
SELECT pg_temp.check((SELECT total_count IS NULL FROM public.search_vehicles_browse(p_sort_by => 'newest', p_include_total => false) LIMIT 1), 'p_include_total false still returns no total');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.search_vehicles_browse(p_make => 'Porsche', p_model => 'Carrera GT', p_source => 'gooding')), 'the source filter still applies');
SELECT pg_temp.check(has_function_privilege('anon', 'public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean)', 'execute'), 'anon can read');
SELECT pg_temp.check(has_function_privilege('authenticated', 'public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean)', 'execute'), 'authenticated can read');
SELECT pg_temp.check((SELECT prosrc LIKE '%sale basis (2026-10-20)%' FROM pg_proc WHERE oid = 'public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean)'::regprocedure), 'the deployed source carries its marker');

SELECT 'search_vehicles_browse sale basis contract passed' AS result;
