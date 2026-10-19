-- Isolated PostgreSQL 17 contract for 20261016180000_treemap_populations_by_house.sql. Synthetic rows only; never production.
-- Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_by_house && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_by_house -f supabase/sql/test_treemap_populations_by_house.sql
-- Covered: the receipt keeps every earlier key and value; by_house counts confirmed sales with an amount per house,
-- largest first, with the unrecorded venue as house null; its sales add up to confirmed_sales_with_amount; applied twice.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

CREATE TABLE public.vehicles (id serial PRIMARY KEY, is_public boolean, deleted_at timestamptz, listing_kind text);
INSERT INTO public.vehicles (is_public) SELECT true FROM generate_series(1, 9);
CREATE TABLE public.mv_treemap_outcomes (id serial PRIMARY KEY, source_name text, outcome text, sold_amount numeric);
INSERT INTO public.mv_treemap_outcomes (source_name, outcome, sold_amount) VALUES
  ('Bring a Trailer', 'sold', 100), ('Bring a Trailer', 'sold', 200), ('Bring a Trailer', 'sold', 300),
  ('Mecum', 'sold', 50), ('Mecum', 'sold', 70), (NULL, 'sold', 10), ('Cars & Bids', 'not_sold', NULL),
  ('Cars & Bids', 'sold', 0), ('Barrett-Jackson', 'sold', 90);
CREATE TABLE public.mv_treemap_sale_brands (name text, count bigint);
INSERT INTO public.mv_treemap_sale_brands VALUES ('Porsche', 5), ('Ford', 3);

-- The live receipt (20261014063000), verbatim, for the before value.
CREATE FUNCTION public.treemap_populations() RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
    'measure', 'confirmed_sale_v1',
    'public_records', (SELECT count(*) FROM public.vehicles v
                        WHERE v.is_public IS TRUE AND v.deleted_at IS NULL
                          AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'),
    'known_outcomes', (SELECT count(*) FROM public.mv_treemap_outcomes),
    'confirmed_sales', (SELECT count(*) FROM public.mv_treemap_outcomes WHERE outcome = 'sold'),
    'confirmed_sales_with_amount', (SELECT count(*) FROM public.mv_treemap_outcomes WHERE sold_amount > 0),
    'mapped_makes', (SELECT count(*) FROM public.mv_treemap_sale_brands),
    'mapped_sales', (SELECT COALESCE(sum(count), 0) FROM public.mv_treemap_sale_brands),
    'make_floor', 5,
    'median_floor', 5);
$function$;
CREATE TEMP TABLE before_receipt AS SELECT public.treemap_populations() AS j;

\ir ../migrations/20261016180000_treemap_populations_by_house.sql
\ir ../migrations/20261016180000_treemap_populations_by_house.sql

SELECT pg_temp.ok('every earlier key keeps its value',
  (SELECT j FROM before_receipt) = public.treemap_populations() - 'by_house');
SELECT pg_temp.ok('by_house: confirmed sales with an amount per house, largest first, unrecorded venue as null',
  public.treemap_populations() -> 'by_house' = '[
    {"house": "Bring a Trailer", "sales": 3, "amount": 600},
    {"house": "Mecum", "sales": 2, "amount": 120},
    {"house": "Barrett-Jackson", "sales": 1, "amount": 90},
    {"house": null, "sales": 1, "amount": 10}]'::jsonb);
SELECT pg_temp.ok('by_house sales add up to confirmed_sales_with_amount',
  (SELECT sum((e->>'sales')::int) FROM jsonb_array_elements(public.treemap_populations() -> 'by_house') e)
  = (public.treemap_populations() ->> 'confirmed_sales_with_amount')::int);
