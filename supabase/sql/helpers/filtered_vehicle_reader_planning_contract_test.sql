-- Local-only reproduction. Run in a NEW disposable database named
-- nuke_pulse_reader_test using PostgreSQL 17; never run against a Supabase project.
-- psql -v ON_ERROR_STOP=1 -d nuke_pulse_reader_test -f <this-file>
\set ON_ERROR_STOP on
DO $local_only$ BEGIN
  IF current_database() <> 'nuke_pulse_reader_test' THEN
    RAISE EXCEPTION 'requires disposable local database nuke_pulse_reader_test';
  END IF;
END $local_only$;
\set ON_ERROR_STOP on
create table vehicles(id uuid, trim text, make text,model text,year int,city text,state text,sale_date date,color_family text,mileage int,bat_watchers int,sale_price bigint,sold_price bigint,canonical_sold_price numeric,primary_image_url text,canonical_platform text,is_public boolean);
insert into vehicles select md5(g::text)::uuid,'Coupe',case when g%1000=0 then 'Ford' else 'Other' end,'Mustang',1966,'City','CA','2026-10-01','Red',12000,120,g,null,null,'https://example.invalid/car.jpg','bat',true from generate_series(1,100000) g;
-- Ineligible records would sort above all eligible rows if the photo/public gate moved.
insert into vehicles(id,make,model,year,sale_price,primary_image_url,canonical_platform,is_public)
values ('00000000-0000-4000-8000-000000000001','Ford','Mustang',1966,9000000,'https://example.invalid/private.jpg','bat',false),
       ('00000000-0000-4000-8000-000000000002','Ford','Mustang',1966,9000000,null,'bat',true),
       ('00000000-0000-4000-8000-000000000003','Ford','Mustang',1966,9000000,'','bat',true);
create index on vehicles(make,model);
create index on vehicles(make,year);
analyze vehicles;
CREATE OR REPLACE FUNCTION public.vehicles_by_filters_before(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 60)
 RETURNS TABLE(id uuid, year integer, make text, model text, "trim" text, primary_image_url text, city text, state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$   WITH v AS (SELECT id, trim AS trm, make, model, year, city, state, sale_date, color_family, mileage,            bat_watchers AS watchers,            COALESCE(sale_price, sold_price, canonical_sold_price) AS price,            primary_image_url AS img,            CASE WHEN canonical_platform IN ('bat','cars-and-bids','barrett-jackson','mecum','bonhams','classiccars-com','gooding','rm-sothebys','broad-arrow') THEN 0 ELSE 1 END AS plat_rank FROM vehicles WHERE is_public AND primary_image_url IS NOT NULL AND primary_image_url <> '')   SELECT id, year, make, model, trm, img, city, state   FROM v   WHERE TRUE     AND (NOT (p_filters ? 'make') OR (make) = p_filters->>'make')     AND (NOT (p_filters ? 'model') OR (model) = p_filters->>'model')     AND (NOT (p_filters ? 'year') OR (year::text) = p_filters->>'year')     AND (NOT (p_filters ? 'metro') OR (city||', '||state) = p_filters->>'metro')     AND (NOT (p_filters ? 'dow') OR (to_char(sale_date,'Dy')) = p_filters->>'dow')     AND (NOT (p_filters ? 'color') OR (color_family) = p_filters->>'color')     AND (NOT (p_filters ? 'price') OR (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) = p_filters->>'price')     AND (NOT (p_filters ? 'mileage') OR (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) = p_filters->>'mileage')     AND (NOT (p_filters ? 'popularity') OR (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) = p_filters->>'popularity')   ORDER BY plat_rank, (price IS NULL), price DESC NULLS LAST LIMIT p_limit; $function$;

CREATE OR REPLACE FUNCTION public.vehicles_by_filters(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 60)
 RETURNS TABLE(id uuid, year integer, make text, model text, "trim" text, primary_image_url text, city text, state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$   WITH v AS (SELECT id, trim AS trm, make, model, year, city, state, sale_date, color_family, mileage,            bat_watchers AS watchers,            COALESCE(sale_price, sold_price, canonical_sold_price) AS price,            primary_image_url AS img,            CASE WHEN canonical_platform IN ('bat','cars-and-bids','barrett-jackson','mecum','bonhams','classiccars-com','gooding','rm-sothebys','broad-arrow') THEN 0 ELSE 1 END AS plat_rank FROM vehicles WHERE is_public AND primary_image_url IS NOT NULL AND primary_image_url <> '')   SELECT id, year, make, model, trm, img, city, state   FROM v   WHERE TRUE     AND (NOT (p_filters ? 'make') OR (make) = p_filters->>'make')     AND (NOT (p_filters ? 'model') OR (model) = p_filters->>'model')     AND (NOT (p_filters ? 'year') OR (year::text) = p_filters->>'year')     AND (NOT (p_filters ? 'metro') OR (city||', '||state) = p_filters->>'metro')     AND (NOT (p_filters ? 'dow') OR (to_char(sale_date,'Dy')) = p_filters->>'dow')     AND (NOT (p_filters ? 'color') OR (color_family) = p_filters->>'color')     AND (NOT (p_filters ? 'price') OR (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) = p_filters->>'price')     AND (NOT (p_filters ? 'mileage') OR (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) = p_filters->>'mileage')     AND (NOT (p_filters ? 'popularity') OR (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) = p_filters->>'popularity')   ORDER BY plat_rank, (price IS NULL), price DESC NULLS LAST LIMIT p_limit; $function$;

\ir ../../migrations/20261018232735_replan_filtered_vehicle_reads.sql
\set ON_ERROR_STOP on
DO $assay$
DECLARE f jsonb; lim integer; n integer := 0;
BEGIN
 FOR f IN SELECT value FROM jsonb_array_elements('[{}, {"make": "Ford"}, {"make": "Ford", "model": "Mustang", "year": "1966"}, {"year": "1966"}, {"make": "Ford", "price": "$50-100k"}, {"make": "Ford", "mileage": "10-50k mi"}, {"make": "Ford", "color": "Red"}, {"make": "Ford", "popularity": "100-199 watching"}, {"make": "Ford", "metro": "City, CA"}, {"make": "Ford", "dow": "Thu"}, {"make": "Ford'' OR true--"}, {"make": null}, {"year": "unknown"}, {"price": "$1M+"}, {"mileage": "Under 1k mi"}, {"popularity": "Unrecorded"}]'::jsonb) LOOP
 FOREACH lim IN ARRAY ARRAY[0,1,3,60] LOOP
 IF EXISTS ((SELECT * FROM vehicles_by_filters_before(f,lim) EXCEPT ALL SELECT * FROM vehicles_by_filters(f,lim)) UNION ALL (SELECT * FROM vehicles_by_filters(f,lim) EXCEPT ALL SELECT * FROM vehicles_by_filters_before(f,lim))) THEN RAISE EXCEPTION 'filter mismatch %, limit %',f,lim; END IF;
 n := n+1;
 END LOOP; END LOOP;
 RAISE NOTICE '% filter/limit equivalence cases passed', n;
END $assay$;

DO $eligibility$ BEGIN
  IF EXISTS (SELECT 1 FROM vehicles_by_filters('{"make":"Ford","model":"Mustang","year":"1966"}',60)
             WHERE id IN ('00000000-0000-4000-8000-000000000001'::uuid,
                          '00000000-0000-4000-8000-000000000002'::uuid,
                          '00000000-0000-4000-8000-000000000003'::uuid)) THEN
    RAISE EXCEPTION 'private or unphotographed fixture exposed';
  END IF;
  IF (SELECT count(*) FROM vehicles_by_filters('{"make":"Ford","model":"Mustang","year":"1966"}',3)) <> 3 THEN
    RAISE EXCEPTION 'bounded positive case missing';
  END IF;
  IF EXISTS (SELECT 1 FROM vehicles_by_filters('{"make":"Ford'' OR true--"}',3)) THEN
    RAISE EXCEPTION 'filter data treated as SQL';
  END IF;
  RAISE NOTICE 'photo/public exclusions, positive limit and quoted filter passed';
END $eligibility$;
