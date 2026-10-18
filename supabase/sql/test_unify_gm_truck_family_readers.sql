-- Disposable PG17 only. Reuses the existing umbrella's source-to-family-to-reader contract.
\set ON_ERROR_STOP on
\ir test_pickup_umbrella_and_series_aliases.sql

INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases)
VALUES ('00000000-0000-4000-a000-000000000099', 'GMC', 'GMC', '{}');

CREATE TEMP TABLE gm_lines AS
SELECT make, model, row_number() OVER ()::integer n
FROM (VALUES ('Chevrolet','Colorado'),('Chevrolet','Avalanche'),('Chevrolet','SSR'),
 ('Chevrolet','LUV'),('Chevrolet','El Camino'),('GMC','Pickup'),('GMC','Canyon'),('GMC','Hummer EV Pickup'),
 ('GMC','Yukon')) x(make, model);
INSERT INTO public.canonical_models(id, make, canonical_model, year_start, year_end, aliases)
SELECT ('00000000-0000-4000-b000-' || lpad((1000+n)::text,12,'0'))::uuid,
 make, model, 1900, 2030, ARRAY[lower(model)] FROM gm_lines;
INSERT INTO public.vehicles(id, make, model, sale_date)
SELECT ('00000000-0000-4000-8000-' || lpad((1000+n*10+i)::text,12,'0'))::uuid,
 make, model, current_date - (n*10+i) FROM gm_lines CROSS JOIN generate_series(1,3) i;
INSERT INTO public.mv_treemap_outcomes(id, brand_name, model, year, outcome, sold_amount, source_name)
SELECT id, make, model, 2005, 'sold', 20000, 'Bring a Trailer' FROM public.vehicles v WHERE model IN (SELECT model FROM gm_lines) AND NOT EXISTS (SELECT 1 FROM public.mv_treemap_outcomes o WHERE o.id=v.id);
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW public.mv_family_market;
REFRESH MATERIALIZED VIEW public.mv_family_sales;

SELECT pg_temp.ok('before: modern Chevrolet pickup names are absent from the old umbrella',
 NOT EXISTS (SELECT 1 FROM public.treemap_family_models('Chevrolet','00000000-0000-4000-b000-000000000100')
 WHERE model IN ('Colorado','Avalanche','SSR','LUV','El Camino')));

\ir ../migrations/20261018210612_unify_gm_truck_family_readers.sql
CREATE TEMP TABLE reader_once AS SELECT oid, prosrc, proacl FROM pg_proc
 WHERE oid IN ('public.treemap_family_models(text,text)'::regprocedure,'public.treemap_family_sales(text,text,integer)'::regprocedure);
\ir ../migrations/20261018210612_unify_gm_truck_family_readers.sql

SELECT pg_temp.ok('all five Chevrolet pickup lines join the umbrella with their actual model names',
 (SELECT count(*) FROM public.treemap_family_models('Chevrolet','00000000-0000-4000-b000-000000000100')
 WHERE model IN ('Colorado','Avalanche','SSR','LUV','El Camino')) = 5
 AND (public.treemap_family_sales('Chevrolet','00000000-0000-4000-b000-000000000100')->>'n')::int = 24);
SELECT pg_temp.ok('GMC Canyon and Hummer EV Pickup join Pickup; Yukon and Chevrolet do not',
 (SELECT sum(sold) FROM public.treemap_family_models('GMC','00000000-0000-4000-b000-000000001006')) = 9
 AND NOT EXISTS (SELECT 1 FROM public.treemap_family_models('GMC','00000000-0000-4000-b000-000000001006') WHERE model='Yukon')
 AND (public.treemap_family_sales('GMC','00000000-0000-4000-b000-000000001006')->>'n')::int = 9);
SELECT pg_temp.ok('specific C10 remains scoped and an unknown key remains empty',
 (SELECT sum(sold) FROM public.treemap_family_models('Chevrolet','00000000-0000-4000-b000-000000000105')) = 3
 AND NOT EXISTS (SELECT 1 FROM public.treemap_family_models('Chevrolet','missing')));
SELECT pg_temp.ok('repeat application preserves exact readers and existing grants',
 NOT EXISTS (SELECT 1 FROM reader_once r JOIN pg_proc p ON p.oid=r.oid WHERE p.prosrc IS DISTINCT FROM r.prosrc OR p.proacl IS DISTINCT FROM r.proacl));
SET ROLE anon;
SELECT * FROM public.treemap_family_models('GMC','00000000-0000-4000-b000-000000001006');
SELECT public.treemap_family_sales('Chevrolet','00000000-0000-4000-b000-000000000100')->>'n';
RESET ROLE;
